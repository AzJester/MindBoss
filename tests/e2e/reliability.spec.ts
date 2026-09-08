import { test, expect } from "@playwright/test";
import { testDatabase, disposeTestDatabases } from "../support/database";

test.use({ serviceWorkers: "block" });
test.afterEach(async () => {
  await disposeTestDatabases();
});
test("real API filters, offline recovery, details, and explicit AI selection", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const database = await testDatabase("https://mindboss.st-dba.com");
  const title = "Persistent test note";
  const tag = (
    await (
      await database.call("/tags", "POST", {
        name: "CHECK",
        triggers: ["keyword"],
      })
    ).json()
  ).tags[0];
  await database.call("/entries", "POST", {
    id: crypto.randomUUID(),
    kind: "note",
    title,
    body: "keyword content",
  });
  await database.call("/entries", "POST", {
    id: crypto.randomUUID(),
    kind: "list",
    title: "Unrelated list",
    listItems: Array.from({ length: 7 }, (_, i) => ({
      id: crypto.randomUUID(),
      text: "Task " + (i + 1),
      position: i,
      dueAt: null,
      completedAt: null,
    })),
  });
  let offline = false;
  let releaseDetails: () => void = () => undefined;
  let heldDetails = false;
  let holdDetails = true;
  const detailsGate = new Promise<void>((resolve) => {
    releaseDetails = resolve;
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://mindboss.st-dba.com") return route.abort();
    if (url.pathname.startsWith("/api/v1")) {
      if (offline) return route.abort("internetdisconnected");
      const incoming = route.request();
      const body = incoming.postData();
      const response = await database.call(
        url.pathname.slice(7) + url.search,
        incoming.method(),
        body ? JSON.parse(body) : undefined,
        { "x-csrf-token": incoming.headers()["x-csrf-token"] || "" },
      );
      if (
        holdDetails &&
        incoming.method() === "GET" &&
        /^\/api\/v1\/entries\/[a-f0-9-]+$/.test(url.pathname)
      ) {
        heldDetails = true;
        await detailsGate;
      }
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
  await page.goto("https://mindboss.st-dba.com/");
  await expect(page.locator(".entry-card")).toHaveCount(2);
  await page.getByLabel("Search entries").fill("tag:check type:note");
  await expect(page.locator(".entry-card")).toHaveCount(1);
  await expect(page.locator(".entry-card")).toContainText(title);
  await page.getByLabel("Search entries").fill("tag:not-a-real-tag");
  await expect(page.locator(".entry-card")).toHaveCount(0);
  await page.getByLabel("Search entries").fill("");
  await expect(page.locator(".entry-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Open " + title, exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  await expect.poll(() => heldDetails).toBe(true);
  await page.getByRole("button", { name: "Close entry" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const detailsResponse = page.waitForResponse((response) =>
    /\/api\/v1\/entries\/[a-f0-9-]+$/.test(new URL(response.url()).pathname),
  );
  holdDetails = false;
  releaseDetails();
  await detailsResponse;
  // Wait for the real cache write that precedes the UI's detail refresh.
  await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("mindboss-offline", 2);
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await new Promise<Array<{ id: string }>>((resolve) => {
      const request = db
        .transaction("state", "readonly")
        .objectStore("state")
        .getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return rows.some((row) => /^api:\/entries\/[a-f0-9-]+$/.test(row.id));
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all 7 tasks" }).click();
  await expect(page.getByText("Task 7", { exact: true })).toBeVisible();
  offline = true;
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Inbox");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Title/).fill("Offline recovered");
  await page
    .getByLabel("Note", { exact: true })
    .fill("Keep this safe through reload.");
  await page.getByRole("button", { name: "Save to Mind Boss" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".sync-banner")).toBeVisible();
  const rows = await database.db
    .prepare("SELECT title FROM entries WHERE title=?")
    .all("Offline recovered");
  expect(rows).toHaveLength(0);
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.locator(".entry-card").filter({ hasText: "Offline recovered" }),
  ).toBeVisible({ timeout: 15000 });
  await page.goto("https://mindboss.st-dba.com/?view=ai");
  await expect(
    page.getByRole("heading", { name: "AI workspace", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 selected · maximum 40")).toBeVisible();
  await page
    .locator(".selection-list label")
    .filter({ hasText: "Unrelated list" })
    .getByRole("checkbox")
    .check();
  await page.locator(".data-preview summary").click();
  await expect(page.locator(".data-preview pre")).toContainText("Task 7");
  await expect(page.locator(".data-preview pre")).not.toContainText(title);
  await expect(
    page.getByRole("button", { name: "Run AI tool" }),
  ).toBeDisabled();
  expect(tag.name).toBe("CHECK");
  await page.goto("https://mindboss.st-dba.com/?view=settings");
  await expect(
    page.getByText(/3 entries across Inbox, Archive and Trash/),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "data", exact: true })
    .click();
  await expect(
    page.getByText(/3 entries · 0 attachments · 0.0 MB/),
  ).toBeVisible();
  await expect(page.locator(".utility-panel")).not.toContainText("undefined");
  await expect(page.locator(".utility-panel")).not.toContainText("NaN");
});
test("calendar overflow, mobile agenda, light contrast and backup controls", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Inbox");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.locator(isMobile ? ".calendar-agenda" : ".calendar-grid"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Grid", exact: true }),
  ).toBeVisible();
  await page.goto("/?view=settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "appearance", exact: true })
    .click();
  await page.getByRole("button", { name: "light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByLabel("Search entries")).toHaveCSS(
    "background-color",
    "rgb(237, 242, 245)",
  );
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "data", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Restore a Mind Boss backup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Complete library storage" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({
    path: "test-results/settings-" + page.viewportSize()!.width + ".png",
    fullPage: true,
  });
});
