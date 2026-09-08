import type { Entry } from "./types";
export interface AiEntry {
  title: string;
  body: string;
  tags: string[];
  kind?: string;
  sourceUrl?: string | null;
  reminderAt?: string | null;
  reminderState?: string | null;
  listItems?: Array<{
    text: string;
    dueAt: string | null;
    completedAt: string | null;
  }>;
  attachments?: Array<{ fileName: string; extractedText: string }>;
}
export function aiEntry(entry: Entry, attachments = false): AiEntry {
  return {
    title: entry.title,
    body: entry.body,
    tags: entry.tags.map((tag) => tag.name),
    kind: entry.kind,
    sourceUrl: entry.sourceUrl,
    reminderAt: entry.reminderAt,
    reminderState: entry.reminderState,
    listItems: entry.listItems.map(({ text, dueAt, completedAt }) => ({
      text,
      dueAt,
      completedAt,
    })),
    attachments: attachments
      ? entry.attachments.map((file) => ({
          fileName: file.fileName,
          extractedText: file.extractedText || "",
        }))
      : [],
  };
}
export function serializeAiEntries(entries: AiEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
export const AI_INPUT_LIMIT = 60_000;
