import * as chrono from "chrono-node";

export function parseReminder(
  text: string,
  reference = new Date(),
): Date | null {
  if (!text.trim()) return null;
  return chrono.parseDate(
    text,
    { instant: reference, timezone: -420 },
    { forwardDate: true },
  );
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
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

export function tomorrowMorning(reference = new Date()): Date {
  const phoenixNow = new Date(reference.getTime() - 7 * 60 * 60_000);
  return new Date(
    Date.UTC(
      phoenixNow.getUTCFullYear(),
      phoenixNow.getUTCMonth(),
      phoenixNow.getUTCDate() + 1,
      16,
      0,
      0,
      0,
    ),
  );
}
