import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Inbox");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
}

async function share(page: Page, count = 2) {
  await page.evaluate(async (count) => {
    const form = new FormData();
    form.set("title", "Android shared reference");
    form.set("text", "Shared text preserved on this device");
    form.set("url", "https://example.com/reference");
    for (let i = 0; i < count; i++)
      form.append(
        "files",
        new File(["%PDF-1.4\n% test fixture " + i], "reference-" + i + ".pdf", {
          type: "application/pdf",
        }),
      );
    const response = await fetch("/capture/share", {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error("Share was not stored");
  }, count);
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Capture entry", exact: true }),
  ).toBeVisible();
}

test("installed service worker serves the complete shell on an offline reload", async ({
  page,
  context,
}) => {
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Inbox");
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Title/).fill("Offline draft");
  await page
    .getByLabel("Note", { exact: true })
    .fill("Survives a closed composer");
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel(/Title/)).toHaveValue("Offline draft");
});

test("share target stores files before navigation and retains them through refresh", async ({
  page,
}) => {
  await ready(page);
  await share(page);
  await expect(page.getByLabel(/Title/)).toHaveValue(
    "Android shared reference",
  );
  await expect(page.locator(".attachment-previews article")).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel(/Title/)).toHaveValue(
    "Android shared reference",
  );
  await expect(page.locator(".attachment-previews article")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Save to Mind Boss", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".entry-card").filter({ hasText: "Android shared reference" }),
  ).toBeVisible();
});

test("oversized share count remains recoverable instead of silently dropping files", async ({
  page,
}) => {
  await ready(page);
  await share(page, 6);
  await expect(page.locator(".attachment-previews article")).toHaveCount(6);
  await expect(page.getByRole("alert")).toContainText(
    "Choose up to five attachments",
  );
  await expect(
    page.getByRole("button", { name: "Save to Mind Boss", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove reference-5.pdf", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save to Mind Boss", exact: true }),
  ).toBeEnabled();
});
