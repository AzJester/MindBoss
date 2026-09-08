import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const worker = await readFile(
  new URL("../workers/reminders.ts", import.meta.url),
  "utf8",
);

describe("reminder delivery safety", () => {
  it("claims each reminder before sending and recovers stale claims", () => {
    expect(worker).toContain("reminder_state = 'sending'");
    expect(worker).toContain("if (!claim.meta.changes) continue");
    expect(worker).toContain("updated_at < ?");
  });

  it("removes permanently expired push subscriptions", () => {
    expect(worker).toContain("statusCode === 404 || statusCode === 410");
    expect(worker).toContain("DELETE FROM push_subscriptions");
  });

  it("honors quiet hours and advances recurring reminders", () => {
    expect(worker).toContain("quiet_start, quiet_end");
    expect(worker).toContain('rule === "weekdays"');
    expect(worker).toContain('rule === "monthly"');
    expect(worker).toContain('nextAt ? "pending" : "delivered"');
  });
});
