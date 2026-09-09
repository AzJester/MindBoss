import { expect, test, type Page } from "@playwright/test";
import type { Entry } from "../../shared/types";
import { dateKey, localInstant, shiftDate } from "../../shared/time";

const timeZone = "America/Phoenix";
const today = dateKey(new Date(), timeZone);
function reminder(title: string, days: number): Entry {
  const createdAt = localInstant(today, 12, 0, timeZone).toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "reminder",
    title,
    body: "A useful next step for this week.",
    source: "web",
    sourceUrl: null,
    sourceTitle: null,
    status: "active",
    pinnedAt: null,
    reminderAt: localInstant(
      shiftDate(today, days),
      9,
      0,
      timeZone,
    ).toISOString(),
    reminderState: "pending",
    recurrenceRule: null,
    reviewAt: null,
    lastViewedAt: null,
    viewCount: 0,
    createdAt,
    updatedAt: createdAt,
    version: 1,
    listItems: [],
    tags: [],
    attachments: [],
  };
}
async function openToday(page: Page, entries: Entry[], theme = "dark") {
  await page.addInitScript(
    ({ entries, theme }) => {
      localStorage.setItem("mindboss.local.entries", JSON.stringify(entries));
      localStorage.setItem(
        "mindboss.local.preferences",
        JSON.stringify({ theme, displayTimezone: "America/Phoenix" }),
      );
    },
    { entries, theme },
  );
  await page.goto("/?view=today");
  await expect(
    page.getByRole("tablist", { name: "Today categories" }),
  ).toBeVisible();
}

for (const theme of ["dark", "light"]) {
  test(`Today shows one compact category and no repeated sections in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await openToday(
      page,
      [
        reminder("Review project proposal", 1),
        reminder("Schedule next week’s planning", 7),
      ],
      theme,
    );
    const tabs = page.getByRole("tablist", { name: "Today categories" });
    const panel = page.getByRole("tabpanel");
    await expect(tabs.getByRole("tab")).toHaveCount(4);
    await expect(tabs.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(
      page.getByRole("tab", { name: "Upcoming, 2 entries" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveCount(1);
    await expect(panel.locator(".entry-card")).toHaveCount(2);
    await expect(
      page.locator(".today-summary, .today-group, .today-empty"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: /^(Overdue|Due today|Upcoming|Captured today)$/,
      }),
    ).toHaveCount(0);
    for (const tab of await tabs.getByRole("tab").all()) {
      const size = await tab.boundingBox();
      expect(size!.height).toBeGreaterThanOrEqual(44);
      expect(size!.height).toBeLessThanOrEqual(48);
      expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
        true,
      );
    }
    expect((await tabs.boundingBox())!.height).toBeLessThanOrEqual(112);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      path: testInfo.outputPath(`today-${theme}.png`),
      fullPage: true,
    });

    const captured = page.getByRole("tab", {
      name: "Captured today, 2 entries",
    });
    await captured.click();
    await captured.click();
    await expect(captured).toHaveAttribute("aria-selected", "true");
    await expect(panel.locator(".entry-card")).toHaveCount(2);
    // A real data refresh must not switch back to the default category.
    await page.getByLabel("Search entries").fill("Review project");
    await expect(panel.locator(".entry-card")).toHaveCount(1);
    await expect(
      page.getByRole("tab", { name: "Captured today, 1 entry" }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Search entries").fill("");
    await expect(captured).toHaveAttribute("aria-selected", "true");
    await expect(panel.locator(".entry-card")).toHaveCount(2);

    await captured.focus();
    await page.keyboard.press("Home");
    const overdue = page.getByRole("tab", { name: "Overdue, 0 entries" });
    await expect(overdue).toBeFocused();
    await expect(overdue).toHaveAttribute("aria-selected", "true");
    await expect(panel.locator(".entry-card")).toHaveCount(0);
    await expect(panel.getByRole("status")).toHaveText("Nothing is overdue.");
    await expect(page.locator(".today-empty")).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Due today, 0 entries" }),
    ).toBeFocused();
    await expect(panel.getByRole("status")).toHaveText(
      "No entries are due today.",
    );
    await page.keyboard.press("End");
    await expect(captured).toBeFocused();
    await expect(panel.locator(".entry-card")).toHaveCount(2);
    await page.keyboard.press("ArrowRight");
    await expect(overdue).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(captured).toBeFocused();
  });
}

test("an empty Today view shows one message, and populated views prioritize overdue work", async ({
  page,
}) => {
  await openToday(page, []);
  await expect(
    page.getByRole("tab", { name: "Due today, 0 entries" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".today-empty")).toHaveCount(1);
  await expect(page.getByRole("tabpanel")).toHaveText(
    "No entries are due today.",
  );
  await page.evaluate(
    (entries) => {
      localStorage.setItem("mindboss.local.entries", JSON.stringify(entries));
    },
    [
      reminder("Overdue follow-up", -1),
      reminder("Today’s review", 0),
      reminder("Next week", 7),
    ],
  );
  await page.getByRole("button", { name: "Refresh and synchronize" }).click();
  await expect(
    page.getByRole("tab", { name: "Overdue, 1 entry" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").locator(".entry-card")).toHaveCount(
    1,
  );
  await expect(page.getByRole("tabpanel")).toContainText("Overdue follow-up");
});
