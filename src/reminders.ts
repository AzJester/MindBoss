import * as chrono from "chrono-node";

export function parseReminder(
  text: string,
  reference = new Date(),
  timeZone = "America/Phoenix",
): Date | null {
  if (!text.trim()) return null;
  const initialOffset = timeZoneOffsetMinutes(timeZone, reference);
  const initial = chrono.parseDate(
    text,
    { instant: reference, timezone: initialOffset },
    { forwardDate: true },
  );
  if (!initial) return null;
  const targetOffset = timeZoneOffsetMinutes(timeZone, initial);
  return targetOffset === initialOffset
    ? initial
    : chrono.parseDate(
        text,
        { instant: reference, timezone: targetOffset },
        { forwardDate: true },
      );
}

export function formatDateTime(
  value: string | Date,
  timeZone = "America/Phoenix",
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function isDue(value: string | null): boolean {
  return Boolean(value && Date.parse(value) <= Date.now());
}

export function dateKeyForTimeZone(
  value: string | Date,
  timeZone = "America/Phoenix",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function timeZoneOffsetMinutes(
  timeZone: string,
  reference = new Date(),
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(reference);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value || 0);
  const localAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((localAsUtc - reference.getTime()) / 60_000);
}

export function tomorrowMorning(
  reference = new Date(),
  timeZone = "America/Phoenix",
): Date {
  const [year, month, day] = dateKeyForTimeZone(reference, timeZone)
    .split("-")
    .map(Number);
  const localGuess = Date.UTC(year, month - 1, day + 1, 9, 0, 0, 0);
  const offset = timeZoneOffsetMinutes(timeZone, new Date(localGuess));
  return new Date(localGuess - offset * 60_000);
}
