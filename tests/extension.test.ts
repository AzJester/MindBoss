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
      ["activeTab", "contextMenus", "scripting", "storage"].sort(),
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

  it("queues transient failures but not revoked tokens", () => {
    expect(background).toMatch(
      /response\.status === 401\s+\|\|\s+response\.status === 403\s+\|\|\s+response\.status === 400/,
    );
    expect(background).toContain("mindbossQueue");
  });
});
