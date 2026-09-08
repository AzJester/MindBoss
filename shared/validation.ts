import type { CaptureSource, EntryInput, EntryKind } from "./types";

export const ENTRY_KINDS: EntryKind[] = ["note", "list", "reminder"];
export const CAPTURE_SOURCES: CaptureSource[] = [
  "web",
  "android_share",
  "chrome_extension",
  "mindchuk_import",
];
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_TITLE_LENGTH = 500;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function normalizeWhitespace(
  value: unknown,
  max = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function normalizeTagName(value: unknown): string {
  return normalizeWhitespace(value, 40)
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("en-US");
}

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateEntryInput(value: unknown): EntryInput {
  if (!value || typeof value !== "object")
    throw new Error("Entry payload is required.");
  const input = value as Partial<EntryInput>;
  if (
    typeof input.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.id,
    )
  )
    throw new Error("A valid entry ID is required.");
  if (!input.kind || !ENTRY_KINDS.includes(input.kind))
    throw new Error("Entry type is invalid.");
  const title = normalizeWhitespace(input.title, MAX_TITLE_LENGTH);
  const body = normalizeWhitespace(input.body);
  const listItems = Array.isArray(input.listItems)
    ? input.listItems
        .slice(0, 250)
        .map((item, index) => ({
          id: String(item.id || crypto.randomUUID()),
          text: normalizeWhitespace(item.text, 2_000),
          position: index,
          completedAt:
            typeof item.completedAt === "string" ? item.completedAt : null,
        }))
        .filter((item) => item.text)
    : [];
  if (!title && !body && listItems.length === 0)
    throw new Error("Add a title, note, or list item before saving.");
  const sourceUrl = isHttpUrl(input.sourceUrl) ? input.sourceUrl! : null;
  const reminderAt =
    input.reminderAt && !Number.isNaN(Date.parse(input.reminderAt))
      ? new Date(input.reminderAt).toISOString()
      : null;
  return {
    id: input.id,
    kind: input.kind,
    title,
    body,
    source:
      input.source && CAPTURE_SOURCES.includes(input.source)
        ? input.source
        : "web",
    sourceUrl,
    sourceTitle:
      normalizeWhitespace(input.sourceTitle, MAX_TITLE_LENGTH) || null,
    reminderAt,
    tagIds: Array.isArray(input.tagIds)
      ? [...new Set(input.tagIds.map(String))].slice(0, 30)
      : [],
    listItems,
  };
}

export function triggerMatches(text: string, trigger: string): boolean {
  const escaped = trigger.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`,
    "iu",
  ).test(text);
}
