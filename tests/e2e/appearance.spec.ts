import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { testDatabase, disposeTestDatabases } from "../support/database";

test.use({ serviceWorkers: "block" });
test.afterEach(disposeTestDatabases);

async function appearanceFixture(page: Page, request: APIRequestContext) {
  const origin = "https://mindboss.test";
  const database = await testDatabase(origin);
  await database.call("/preferences", "PATCH", {
    defaultCaptureKind: "list",
    weeklyReviewDay: 3,
    quietStart: "21:00",
    quietEnd: "07:00",
  });
  // Older accounts can have an incomplete or equal quiet-hours pair.
  await database.db
    .prepare("UPDATE user_preferences SET quiet_end=quiet_start")
    .run();
  await database.call("/entries", "POST", {
    id: crypto.randomUUID(),
    kind: "reminder",
    title: "Time zone check",
    reminderAt: "2030-05-10T16:00:00.000Z",
  });
  const patches: Array<Record<string, unknown>> = [];
  const state = {
    failSave: false,
    saveGate: null as Promise<void> | null,
  };
  await page.route("**/*", async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    // Every request is isolated. This test never contacts the production app.
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith("/api/v1")) {
      const body = incoming.postData();
      if (
        url.pathname === "/api/v1/preferences" &&
        incoming.method() === "PATCH"
      ) {
        patches.push(JSON.parse(body || "{}"));
        if (state.saveGate) await state.saveGate;
        if (state.failSave)
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "unavailable", message: "Please try again." },
            }),
          });
      }
      const response = await database.call(
        url.pathname.slice(7) + url.search,
        incoming.method(),
        body ? JSON.parse(body) : undefined,
        { "x-csrf-token": incoming.headers()["x-csrf-token"] || "" },
      );
      return route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    }
    const response = await request.get(
      "http://127.0.0.1:4173" + url.pathname + url.search,
    );
    return route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    });
  });
  await page.goto(origin + "/?view=settings");
  await openAppearance(page);
  return { database, patches, state, origin };
}

async function openAppearance(page: Page) {
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "appearance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Appearance and local time" }),
  ).toBeVisible();
}

test("account appearance controls save independently, persist and change the rendered UI", async ({
  page,
  request,
}) => {
  const { database, patches, origin } = await appearanceFixture(page, request);
  const theme = page.getByRole("group", { name: "Color theme" });
  const font = page.getByRole("group", { name: "Dashboard font" });
  const feedback = page.locator(".preference-save-feedback");
  for (const choice of ["light", "dark", "system"]) {
    await theme.getByRole("button", { name: choice, exact: true }).click();
    await expect(feedback.getByRole("status")).toHaveText(
      "Saved to your account.",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", choice);
    await expect(
      theme.getByRole("button", { name: choice, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(patches.at(-1)).toEqual({ theme: choice });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(243, 246, 248)",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(12, 18, 22)",
  );
  for (const choice of ["modern", "system", "classic"]) {
    await font
      .getByRole("button", { name: "Aa Bb 123 " + choice, exact: true })
      .click();
    await expect(feedback.getByRole("status")).toHaveText(
      "Saved to your account.",
    );
    await expect(page.locator("html")).toHaveAttribute("data-font", choice);
    expect(patches.at(-1)).toEqual({ fontFamily: choice });
  }
  await expect(page.locator("body")).toHaveCSS(
    "font-family",
    'Georgia, "Times New Roman", serif',
  );
  await page.getByLabel("Time zone", { exact: true }).selectOption("UTC");
  await expect(feedback.getByRole("status")).toHaveText(
    "Saved to your account.",
  );
  expect(patches.at(-1)).toEqual({ displayTimezone: "UTC" });
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue(
    "UTC",
  );
  const saved = (await (await database.call("/preferences")).json())
    .preferences;
  expect(saved).toMatchObject({
    theme: "system",
    fontFamily: "classic",
    displayTimezone: "UTC",
    quietStart: "21:00",
    quietEnd: "21:00",
    defaultCaptureKind: "list",
    weeklyReviewDay: 3,
  });
  await page.reload();
  await openAppearance(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await expect(page.locator("html")).toHaveAttribute("data-font", "classic");
  await expect(page.getByLabel("Time zone", { exact: true })).toHaveValue(
    "UTC",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({
    path: test.info().outputPath("appearance-saved.png"),
    fullPage: true,
  });
  await page.goto(origin + "/?view=reminders");
  await expect(page.locator(".reminder-chip")).toContainText("4:00 PM");
  await page.goto(origin + "/?view=settings");
  await openAppearance(page);
  await page
    .getByLabel("Time zone", { exact: true })
    .selectOption("America/Phoenix");
  await expect(feedback.getByRole("status")).toHaveText(
    "Saved to your account.",
  );
  await page.goto(origin + "/?view=reminders");
  await expect(page.locator(".reminder-chip")).toContainText("9:00 AM");
});

test("appearance saves show pending and persistent error states with safe retry", async ({
  page,
  request,
}) => {
  const { database, patches, state } = await appearanceFixture(page, request);
  const light = page
    .getByRole("group", { name: "Color theme" })
    .getByRole("button", { name: "light", exact: true });
  const feedback = page.locator(".preference-save-feedback");
  let releaseSave = () => {};
  state.saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  state.failSave = true;
  await light.click();
  await expect(feedback.getByRole("status")).toHaveText("Saving your choice…");
  for (const control of await page
    .locator(".appearance-card button, .appearance-card select")
    .all())
    await expect(control).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  releaseSave();
  state.saveGate = null;
  await expect(feedback.getByRole("alert")).toContainText(
    "Your previous setting is still selected.",
  );
  await expect(light).toBeEnabled();
  await expect(light).toHaveAttribute("aria-pressed", "false");
  expect(patches).toEqual([{ theme: "light" }]);
  expect(
    (await (await database.call("/preferences")).json()).preferences.theme,
  ).toBe("dark");
  await page.screenshot({
    path: test.info().outputPath("appearance-save-error.png"),
    fullPage: true,
  });
  state.failSave = false;
  await light.click();
  await expect(feedback.getByRole("status")).toHaveText(
    "Saved to your account.",
  );
  await expect(feedback.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    (await (await database.call("/preferences")).json()).preferences.theme,
  ).toBe("light");
});
