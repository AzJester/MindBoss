import type { Entry, RecurrenceRule } from "./types";

export function dateKey(
  value: string | Date,
  timeZone = "America/Phoenix",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

export function localInstant(
  key: string,
  hour = 9,
  minute = 0,
  timeZone = "America/Phoenix",
): Date {
  const [year, month, day] = key.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  for (let pass = 0; pass < 3; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    const actual = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
    );
    const difference = target - actual;
    if (!difference) break;
    instant += difference;
  }
  return new Date(instant);
}

export function shiftDate(key: string, days: number): string {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextRecurrence(
  value: string,
  rule: RecurrenceRule | null,
  timeZone = "America/Phoenix",
  after = new Date(value),
  anchorDay?: number | null,
): string | null {
  if (!rule) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  let key = dateKey(value, timeZone);
  const anchor = anchorDay || Number(key.slice(-2));
  // Skip missed occurrences instead of flooding devices after downtime.
  if (
    rule !== "monthly" &&
    new Date(value).getTime() < after.getTime() - 8 * 86400000
  ) {
    if (rule === "weekly") {
      const weeks = Math.max(
        0,
        Math.floor(
          (after.getTime() - new Date(value).getTime()) / (7 * 86400000),
        ) - 1,
      );
      key = shiftDate(key, weeks * 7);
    } else key = shiftDate(dateKey(after, timeZone), -1);
  }
  for (let i = 0; i < 10000; i++) {
    if (rule === "monthly") {
      const [y, m] = key.split("-").map(Number);
      const month = new Date(Date.UTC(y, m, 1));
      const last = new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
      ).getUTCDate();
      key =
        month.toISOString().slice(0, 7) +
        "-" +
        String(Math.min(anchor, last)).padStart(2, "0");
    } else {
      key = shiftDate(key, rule === "weekly" ? 7 : 1);
      if (rule === "weekdays")
        while ([0, 6].includes(new Date(key + "T12:00:00Z").getUTCDay()))
          key = shiftDate(key, 1);
    }
    const next = localInstant(key, hour, minute, timeZone);
    if (next > after) return next.toISOString();
  }
  throw new Error("Recurrence is outside the supported date range.");
}

export function entryDueDates(entry: Entry): string[] {
  return [
    entry.reminderState === "completed" ? null : entry.reminderAt,
    ...entry.listItems
      .filter((item) => !item.completedAt)
      .map((item) => item.dueAt),
  ].filter(Boolean) as string[];
}
