import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
  test(`list Due controls stay aligned without wrapping in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    if (theme === "light") {
      await page.getByLabel("View options").click();
      await page.getByLabel("Light mode").check();
      await page.getByLabel("View options").click();
    }
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("tab", { name: "list", exact: true }).click();
    await page.getByLabel(/Title/).fill("Project checklist");
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "Add item" }).click();
      await page
        .getByPlaceholder(/item/)
        .nth(i)
        .fill(
          [
            "Send the project update",
            "Review platform options and follow up with the team",
            "Complete the travel claim",
            "Arrange the upcoming site visit",
            "Confirm the software renewal",
          ][i],
        );
    }
    const rows = page.locator(".list-edit-row");
    const assertLayout = async () => {
      for (const row of await rows.all()) {
        const button = row.locator(".date-trigger");
        await expect(button).toHaveCSS("display", "flex");
        const metrics = await button.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const icon = element.querySelector("svg")!.getBoundingClientRect();
          const label = element.querySelector("span")!;
          const text = label.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(label);
          return {
            width: bounds.width,
            height: bounds.height,
            lines: range.getClientRects().length,
            gap: text.left - icon.right,
            centered: Math.abs(
              text.top + text.height / 2 - (icon.top + icon.height / 2),
            ),
            inside:
              icon.left >= bounds.left &&
              text.right <= bounds.right &&
              text.bottom <= bounds.bottom,
          };
        });
        expect(metrics.width).toBeGreaterThanOrEqual(100);
        expect(metrics.height).toBeGreaterThanOrEqual(44);
        expect(metrics.lines).toBe(1);
        expect(metrics.gap).toBeGreaterThanOrEqual(6);
        expect(metrics.centered).toBeLessThanOrEqual(1);
        expect(metrics.inside).toBe(true);
      }
      for (let i = 0; i < 4; i++) {
        const before = await rows.nth(i).boundingBox();
        const after = await rows.nth(i + 1).boundingBox();
        expect(before!.y + before!.height).toBeLessThanOrEqual(after!.y);
      }
      const dialog = page.getByRole("dialog").first();
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    };
    await assertLayout();
    const due = rows.first().locator(".date-trigger");
    // The label itself is a usable click target, not just the calendar glyph.
    await due.locator("span").click();
    await expect(
      page.getByRole("button", { name: "Tomorrow", exact: true }),
    ).not.toHaveCSS("display", "grid");
    await page.getByLabel("Custom date", { exact: true }).fill("2026-09-10");
    await expect(due).toContainText("Sep 10");
    await assertLayout();
    await due.locator("span").click();
    await page
      .getByRole("button", { name: "Remove date", exact: true })
      .click();
    await expect(due).toContainText("Set date");
    await due.click();
    await page.getByLabel("Custom date", { exact: true }).fill("2026-09-10");
    await page
      .getByRole("button", { name: "Save to Mind Boss", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Project checklist", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(rows.first().locator(".date-trigger")).toContainText("Sep 10");
    await assertLayout();
    await page
      .getByRole("dialog")
      .first()
      .screenshot({ path: testInfo.outputPath(`list-due-${theme}.png`) });
  });
}
