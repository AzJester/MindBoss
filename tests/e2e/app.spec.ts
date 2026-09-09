import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
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

test("permanently deletes an entry from Trash after confirmation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Title/).fill("Discard this entry");
  await page.getByLabel("Note").fill("This should not remain in Trash.");
  await page.getByRole("button", { name: "Save to Mind Boss" }).click();

  let card = page
    .locator(".entry-card")
    .filter({ hasText: "Discard this entry" });
  await card.getByLabel("Entry actions").click();
  await card.getByRole("button", { name: "Move to trash" }).click();

  await page.goto("/?view=trash");
  await expect(
    page.getByRole("heading", { name: "Recently deleted" }),
  ).toBeVisible();
  card = page.locator(".entry-card").filter({ hasText: "Discard this entry" });
  await expect(card).toBeVisible();
  await card.getByLabel("Entry actions").click();
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("cannot be undone");
    await confirmation.accept();
  });
  await card.getByRole("button", { name: "Delete permanently" }).click();

  await expect(page.getByText("Entry permanently deleted.")).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(
    page.locator(".entry-card").filter({ hasText: "Discard this entry" }),
  ).toHaveCount(0);
});

test("creates, reorders, and completes a list", async ({ page }) => {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("tab", { name: "list" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  const items = page.getByPlaceholder(/item/);
  await items.nth(0).fill("First task");
  await items.nth(1).fill("Second task");
  await expect(
    page
      .locator(".list-edit-columns span:visible, .mobile-due-label:visible", {
        hasText: /^Due$/,
      })
      .first(),
  ).toBeVisible();
  const dueButton = page.getByRole("button", {
    name: "Due date for First task",
    exact: true,
  });
  const dueBox = await dueButton.boundingBox();
  expect(dueBox?.height).toBeGreaterThanOrEqual(44);
  await dueButton.click({ position: { x: 8, y: 20 } });
  await expect(
    page.getByRole("dialog", { name: "Due date for First task", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Custom date", { exact: true }).fill("2026-09-10");
  await expect(dueButton).toContainText("Sep 10");
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
  const navigation = page.getByRole("navigation", {
    name: "Mind Boss sections",
  });
  if (!(await navigation.isVisible()))
    await page.getByRole("button", { name: "Open navigation" }).click();
  await navigation.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Due today,/ })).toBeVisible();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await page.goto("/?view=review");
  await expect(
    page.getByRole("heading", { name: "Review", level: 1 }),
  ).toBeVisible();
});

test("switches board, calendar, flex, and view options", async ({
  page,
  isMobile,
}) => {
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Turn your tags into working columns" }),
  ).toBeVisible();
  const boardSetup = page.locator(".board-setup");
  await boardSetup.getByRole("button", { name: "#IDEAS" }).click();
  await boardSetup.getByRole("button", { name: "#READ" }).click();
  await page.getByRole("button", { name: "Save board columns" }).click();
  await expect(
    page.getByRole("button", { name: "Configure columns" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.locator(isMobile ? ".calendar-agenda" : ".calendar-grid"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.getByLabel("View options").click();
  await page.getByLabel("Compact cards").check();
  await page.getByLabel("Light mode").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".app-shell")).toHaveClass(/compact-mode/);
  await expect(page.locator(".advanced-search")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
});

test("accepts multiple comma-separated trigger words", async ({
  page,
  isMobile,
}) => {
  const navigationButton = page.getByRole("button", {
    name: "Open navigation",
  });
  if (await navigationButton.isVisible()) {
    await navigationButton.click();
  }
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Manage tags" })
    .click();
  await page.getByLabel("Name").fill("AUTOMATION");
  const triggers = page.getByLabel(/Trigger words/);
  await triggers.pressSequentially("alpha, beta, gamma");
  await expect(triggers).toHaveValue("alpha, beta, gamma");
  await page.getByRole("button", { name: "Create tag" }).click();
  const tag = page.locator(".tag-card").filter({ hasText: "#AUTOMATION" });
  await expect(tag).toContainText("alpha");
  await expect(tag).toContainText("beta");
  await expect(tag).toContainText("gamma");
});

test("saves and reuses a capture template", async ({ page, isMobile }) => {
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
