import { describe, expect, it } from "vitest";
import { decryptString, encryptString } from "../functions/api/_lib";
import {
  formatDateTime,
  parseReminder,
  tomorrowMorning,
} from "../src/reminders";
import {
  normalizeTagName,
  triggerMatches,
  validateEntryInput,
} from "../shared/validation";

describe("entry validation", () => {
  it("normalizes text, URLs, tags, and list order", () => {
    const result = validateEntryInput({
      id: "123e4567-e89b-12d3-a456-426614174000",
      kind: "list",
      title: "  Plan\u0000  ",
      source: "not-allowed",
      sourceUrl: "javascript:alert(1)",
      tagIds: ["one", "one", "two"],
      listItems: [
        { id: "a", text: " Second ", position: 12 },
        { id: "b", text: "First", position: -1 },
      ],
    });
    expect(result.title).toBe("Plan");
    expect(result.source).toBe("web");
    expect(result.sourceUrl).toBeNull();
    expect(result.tagIds).toEqual(["one", "two"]);
    expect(result.listItems?.map((item) => [item.text, item.position])).toEqual(
      [
        ["Second", 0],
        ["First", 1],
      ],
    );
  });

  it("rejects empty entries and invalid identifiers", () => {
    expect(() =>
      validateEntryInput({ id: "wrong", kind: "note", body: "text" }),
    ).toThrow(/entry ID/i);
    expect(() =>
      validateEntryInput({ id: crypto.randomUUID(), kind: "note", body: "  " }),
    ).toThrow(/title, note, or list item/i);
  });
});

describe("tag normalization and triggers", () => {
  it("normalizes a tag name", () =>
    expect(normalizeTagName("  #Project alpha ")).toBe("PROJECT ALPHA"));
  it("matches whole words without case sensitivity", () => {
    expect(triggerMatches("A PROJECT decision", "project")).toBe(true);
    expect(triggerMatches("A projected decision", "project")).toBe(false);
    expect(triggerMatches("read: this", "READ")).toBe(true);
  });
});

describe("Phoenix reminders", () => {
  const reference = new Date("2026-09-08T18:00:00.000Z");

  it("parses natural language in Arizona time", () => {
    expect(parseReminder("tomorrow at 9am", reference)?.toISOString()).toBe(
      "2026-09-09T16:00:00.000Z",
    );
  });

  it("formats and calculates tomorrow at nine without daylight saving drift", () => {
    expect(formatDateTime("2026-09-09T16:00:00.000Z")).toContain("9:00 AM");
    expect(tomorrowMorning(reference).toISOString()).toBe(
      "2026-09-09T16:00:00.000Z",
    );
  });
});

describe("encrypted push data", () => {
  it("round-trips without exposing plaintext", async () => {
    const secret = "a-long-development-secret-with-more-than-32-characters";
    const value = JSON.stringify({
      endpoint: "https://push.example.test/abc",
      keys: { p256dh: "public", auth: "auth" },
    });
    const encrypted = await encryptString(secret, value);
    expect(encrypted).not.toContain("push.example.test");
    expect(await decryptString(secret, encrypted)).toBe(value);
  });
});
