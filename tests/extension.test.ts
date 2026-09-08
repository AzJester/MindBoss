import { createContext, runInContext } from "node:vm";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  await readFile(
    new URL("../extension/manifest.json", import.meta.url),
    "utf8",
  ),
);
const background = await readFile(
  new URL("../extension/background.js", import.meta.url),
  "utf8",
);

describe("Chrome clipper security boundary", () => {
  it("uses Manifest V3 and only the planned permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(
      ["activeTab", "contextMenus", "scripting", "storage", "alarms"].sort(),
    );
    expect(manifest.host_permissions).toEqual([
      "https://mindboss.st-dba.com/*",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
  });

  it("keeps a stable extension key and a capture-only API route", () => {
    expect(manifest.key.length).toBeGreaterThan(100);
    expect(background).toContain("/api/v1/clips");
    expect(background).not.toMatch(/api\/v1\/(entries|search|exports)/);
  });

  it("keeps failed captures including revoked-token failures", () => {
    expect(background).toMatch(
      /response\.status === 401\s+\|\|\s+response\.status === 403\s+\|\|\s+response\.status === 400/,
    );
    expect(background).toContain("mindbossQueue");
  });
});
function clipperRuntime() {
  const storage: Record<string, unknown> = { mindbossToken: "test-token" };
  let fail = true;
  let requests = 0;
  const listener = { addListener() {} };
  const context = createContext({
    chrome: {
      runtime: {
        onInstalled: listener,
        onStartup: listener,
        onMessage: listener,
      },
      contextMenus: { onClicked: listener },
      alarms: { onAlarm: listener, create() {} },
      action: { setBadgeBackgroundColor() {}, setBadgeText() {} },
      storage: {
        local: {
          async get() {
            return structuredClone(storage);
          },
          async set(values: Record<string, unknown>) {
            Object.assign(storage, structuredClone(values));
          },
        },
      },
    },
    crypto,
    setTimeout() {},
    Response,
    fetch: async () => {
      requests++;
      return fail
        ? Response.json(
            { error: { message: "Capture token was revoked" } },
            { status: 401 },
          )
        : Response.json({ ok: true });
    },
  });
  runInContext(background, context);
  return {
    storage,
    save: (payload: unknown) => {
      context.testPayload = payload;
      return runInContext("saveClip(testPayload)", context);
    },
    flush: () => runInContext("flushQueue()", context),
    recover: () => {
      fail = false;
    },
    requests: () => requests,
  };
}

it("retains concurrent clips through revoked-token failure and acknowledges only confirmed saves", async () => {
  const runtime = clipperRuntime();
  const results = await Promise.all([
    runtime.save({ id: "first", title: "First" }),
    runtime.save({ id: "second", title: "Second" }),
  ]);
  expect(results.every((value) => value.ok && value.queued)).toBe(true);
  expect(runtime.storage.mindbossQueue).toHaveLength(2);
  expect((await runtime.flush()).remaining).toBe(2);
  runtime.recover();
  expect(await runtime.flush()).toMatchObject({ sent: 2, remaining: 0 });
  expect(runtime.storage.mindbossQueue).toEqual([]);
  expect(runtime.requests()).toBe(6);
});

it("refuses an overfull clip queue without discarding any existing capture", async () => {
  const runtime = clipperRuntime();
  runtime.storage.mindbossQueue = Array.from({ length: 500 }, (_, index) => ({
    id: String(index),
  }));
  expect(await runtime.save({ id: "new" })).toMatchObject({
    ok: false,
    queued: false,
  });
  expect(runtime.storage.mindbossQueue).toHaveLength(500);
  expect(runtime.requests()).toBe(0);
});
