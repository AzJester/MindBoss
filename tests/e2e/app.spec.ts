import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Everything worth keeping" }),
  ).toBeVisible();
});

test("captures and retrieves a note", async ({ page }) => {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Get it out of your head" }),
  ).toBeVisible();
  await page.getByLabel(/Title/).fill("Deployment checklist");
  await page
    .getByLabel("Note")
    .fill("Verify the Android share target and reminder delivery.");
  await page.getByRole("button", { name: "Save to Mind Boss" }).click();
  await expect(page.getByText("Deployment checklist")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search entries" })
    .fill("Android share target");
  await expect(page.getByText("Deployment checklist")).toBeVisible();
});

test("creates, reorders, and completes a list", async ({ page }) => {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("tab", { name: "list" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  const items = page.getByPlaceholder(/item/);
  await items.nth(0).fill("First task");
  await items.nth(1).fill("Second task");
  await page.getByRole("button", { name: "Move item up" }).nth(1).click();
  await page.getByRole("button", { name: "Save to Mind Boss" }).click();
  await page.getByText("Second task").click();
  await expect(page.getByText("1 of 2")).toBeVisible();
});

test("manifest exposes the Android share target", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.share_target.action).toBe("/capture/share");
  expect(
    manifest.icons.some((icon: { sizes: string }) => icon.sizes === "512x512"),
  ).toBeTruthy();
});

test("mobile controls remain usable", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile layout check");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New capture" }).last().click();
  await expect(
    page.getByRole("heading", { name: "Get it out of your head" }),
  ).toBeVisible();
  const box = await page
    .getByRole("button", { name: "Save to Mind Boss" })
    .boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(40);
});

test("creates a tag during capture and supports search syntax", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop workflow check");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByPlaceholder("Find or create a tag").fill("CLIENT-X");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByLabel(/Title/).fill("Client decision");
  await page
    .getByRole("textbox", { name: "Note" })
    .fill("Keep this decision visible.");
  await page.getByRole("button", { name: "Save to Mind Boss" }).click();
  await page
    .getByRole("textbox", { name: "Search entries" })
    .fill("tag:client-x type:note");
  await expect(page.getByText("Client decision")).toBeVisible();
});

test("shows Today and Review workflows", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop workflow check");
  const navigation = page.getByRole("navigation", {
    name: "Mind Boss sections",
  });
  if (!(await navigation.isVisible()))
    await page.getByRole("button", { name: "Open navigation" }).click();
  await navigation.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your day, already gathered" }),
  ).toBeVisible();
  await expect(page.getByText("Due today")).toBeVisible();
  await page.goto("/?view=review");
  await expect(
    page.getByRole("heading", { name: "Reconnect with what matters" }),
  ).toBeVisible();
});

test("saves and reuses a capture template", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop workflow check");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Title/).fill("Decision template");
  await page
    .getByRole("textbox", { name: "Note" })
    .fill("Decision:\nReason:\nNext action:");
  page.once("dialog", (dialog) => dialog.accept("Decision record"));
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText("Capture template saved.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByLabel("Start from a template")
    .selectOption({ label: "Decision record" });
  await expect(page.getByLabel(/Title/)).toHaveValue("Decision template");
});
