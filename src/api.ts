import type {
  Entry,
  EntryInput,
  EntryStatus,
  Session,
  Tag,
} from "../shared/types";
import { strToU8, zipSync } from "fflate";

const LOCAL_ENTRIES_KEY = "mindboss.local.entries";
const LOCAL_TAGS_KEY = "mindboss.local.tags";
export const isLocalMode =
  import.meta.env.VITE_LOCAL_MODE === "true" ||
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function seedLocal(): void {
  if (localStorage.getItem(LOCAL_ENTRIES_KEY)) return;
  const now = Date.now();
  const tags: Tag[] = [
    {
      id: crypto.randomUUID(),
      name: "IDEAS",
      color: "#22d3aa",
      parentId: null,
      triggers: ["idea", "concept"],
      createdAt: new Date(now).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "READ",
      color: "#38bdf8",
      parentId: null,
      triggers: ["read", "article"],
      createdAt: new Date(now).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "PERSONAL",
      color: "#fbbf24",
      parentId: null,
      triggers: ["personal"],
      createdAt: new Date(now).toISOString(),
    },
  ];
  const entries: Entry[] = [
    {
      id: crypto.randomUUID(),
      kind: "note",
      title: "A quieter place for a busy mind",
      body: "Mind Boss keeps useful thoughts, links, and decisions close without turning them into another system to manage.",
      source: "web",
      sourceUrl: null,
      sourceTitle: null,
      status: "active",
      pinnedAt: new Date(now - 1_000).toISOString(),
      reminderAt: null,
      reminderState: null,
      createdAt: new Date(now - 18 * 60_000).toISOString(),
      updatedAt: new Date(now - 18 * 60_000).toISOString(),
      version: 1,
      listItems: [],
      tags: [tags[0]],
      attachments: [],
    },
    {
      id: crypto.randomUUID(),
      kind: "list",
      title: "Today",
      body: "",
      source: "web",
      sourceUrl: null,
      sourceTitle: null,
      status: "active",
      pinnedAt: null,
      reminderAt: null,
      reminderState: null,
      createdAt: new Date(now - 90 * 60_000).toISOString(),
      updatedAt: new Date(now - 90 * 60_000).toISOString(),
      version: 1,
      listItems: [
        {
          id: crypto.randomUUID(),
          text: "Install Mind Boss on Android",
          position: 0,
          completedAt: new Date(now - 30 * 60_000).toISOString(),
        },
        {
          id: crypto.randomUUID(),
          text: "Connect the Chrome clipper",
          position: 1,
          completedAt: null,
        },
        {
          id: crypto.randomUUID(),
          text: "Import MindChuk notes",
          position: 2,
          completedAt: null,
        },
      ],
      tags: [],
      attachments: [],
    },
    {
      id: crypto.randomUUID(),
      kind: "reminder",
      title: "Weekly reset",
      body: "Review captured ideas and clear the inbox.",
      source: "web",
      sourceUrl: null,
      sourceTitle: null,
      status: "active",
      pinnedAt: null,
      reminderAt: new Date(now + 24 * 60 * 60_000).toISOString(),
      reminderState: "pending",
      createdAt: new Date(now - 5 * 60 * 60_000).toISOString(),
      updatedAt: new Date(now - 5 * 60 * 60_000).toISOString(),
      version: 1,
      listItems: [],
      tags: [tags[2]],
      attachments: [],
    },
    {
      id: crypto.randomUUID(),
      kind: "note",
      title: "Design reference",
      body: "Save only the part of a page that matters: its source, selected text, and why it is worth keeping.",
      source: "chrome_extension",
      sourceUrl:
        "https://developer.chrome.com/docs/capabilities/web-apis/web-share-target",
      sourceTitle: "Web Share Target API",
      status: "active",
      pinnedAt: null,
      reminderAt: null,
      reminderState: null,
      createdAt: new Date(now - 28 * 60 * 60_000).toISOString(),
      updatedAt: new Date(now - 28 * 60 * 60_000).toISOString(),
      version: 1,
      listItems: [],
      tags: [tags[1]],
      attachments: [],
    },
  ];
  writeLocal(LOCAL_TAGS_KEY, tags);
  writeLocal(LOCAL_ENTRIES_KEY, entries);
}

async function remote<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrfToken = sessionStorage.getItem("mindboss.csrf") || "";
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET")
    headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let body: {
      error?: { code?: string; message?: string; details?: unknown };
    } = {};
    try {
      body = await response.json();
    } catch {
      /* use fallback */
    }
    throw new ApiError(
      body.error?.code || "request_failed",
      body.error?.message || "Mind Boss could not complete that request.",
      response.status,
      body.error?.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getSession(): Promise<Session> {
  if (isLocalMode) {
    seedLocal();
    const session = {
      authenticated: true,
      csrfToken: "local",
      user: { id: 127560421, login: "AzJester", avatarUrl: "" },
    } satisfies Session;
    sessionStorage.setItem("mindboss.csrf", "local");
    return session;
  }
  const session = await remote<Session>("/session");
  if (session.csrfToken)
    sessionStorage.setItem("mindboss.csrf", session.csrfToken);
  return session;
}

export interface EntryQuery {
  q?: string;
  status?: EntryStatus;
  kind?: Entry["kind"];
  tag?: string;
  sort?: "newest" | "oldest";
  from?: string;
  to?: string;
  pinned?: "true";
  reminderState?: "pending" | "delivered" | "completed";
}

export async function getEntries(query: EntryQuery = {}): Promise<Entry[]> {
  if (isLocalMode) {
    seedLocal();
    const text = (query.q || "").toLocaleLowerCase();
    return readLocal<Entry[]>(LOCAL_ENTRIES_KEY, [])
      .filter((entry) => entry.status === (query.status || "active"))
      .filter((entry) => !query.kind || entry.kind === query.kind)
      .filter(
        (entry) => !query.tag || entry.tags.some((tag) => tag.id === query.tag),
      )
      .filter(
        (entry) =>
          !text ||
          [
            entry.title,
            entry.body,
            entry.sourceTitle,
            entry.sourceUrl,
            ...entry.listItems.map((item) => item.text),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(text),
      )
      .sort((a, b) => {
        if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt))
          return a.pinnedAt ? -1 : 1;
        const direction = query.sort === "oldest" ? 1 : -1;
        return a.createdAt.localeCompare(b.createdAt) * direction;
      });
  }
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value)
      .map(([key, value]) => [key, String(value)]),
  );
  return (await remote<{ entries: Entry[] }>(`/entries?${params}`)).entries;
}

export async function getEntry(id: string): Promise<Entry> {
  if (isLocalMode) {
    const entry = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []).find(
      (item) => item.id === id,
    );
    if (!entry) throw new ApiError("entry_not_found", "Entry not found.", 404);
    return entry;
  }
  return (await remote<{ entry: Entry }>(`/entries/${encodeURIComponent(id)}`))
    .entry;
}

function localAutoTags(entry: Entry, allTags: Tag[]): Entry {
  const content = [
    entry.title,
    entry.body,
    entry.sourceTitle,
    entry.sourceUrl,
    ...entry.listItems.map((item) => item.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  const manual = entry.tags;
  const triggered = allTags.filter((tag) =>
    tag.triggers.some((trigger) =>
      new RegExp(
        `(^|[^\\p{L}\\p{N}_])${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}_]|$)`,
        "iu",
      ).test(content),
    ),
  );
  return {
    ...entry,
    tags: [
      ...new Map(
        [...manual, ...triggered].map((tag) => [tag.id, tag]),
      ).values(),
    ],
  };
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  if (isLocalMode) {
    const entries = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []);
    const tags = readLocal<Tag[]>(LOCAL_TAGS_KEY, []);
    const now = new Date().toISOString();
    const entry: Entry = localAutoTags(
      {
        id: input.id,
        kind: input.kind,
        title: input.title || "",
        body: input.body || "",
        source: input.source || "web",
        sourceUrl: input.sourceUrl || null,
        sourceTitle: input.sourceTitle || null,
        status: "active",
        pinnedAt: null,
        reminderAt: input.reminderAt || null,
        reminderState: input.reminderAt ? "pending" : null,
        createdAt: now,
        updatedAt: now,
        version: 1,
        listItems: input.listItems || [],
        tags: tags.filter((tag) => input.tagIds?.includes(tag.id)),
        attachments: [],
      },
      tags,
    );
    writeLocal(LOCAL_ENTRIES_KEY, [entry, ...entries]);
    return entry;
  }
  return (
    await remote<{ entry: Entry }>("/entries", {
      method: "POST",
      headers: { "idempotency-key": input.id },
      body: JSON.stringify(input),
    })
  ).entry;
}

export async function updateEntry(
  id: string,
  changes: Record<string, unknown>,
): Promise<Entry> {
  if (isLocalMode) {
    const entries = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0)
      throw new ApiError("entry_not_found", "Entry not found.", 404);
    if (
      typeof changes.version === "number" &&
      changes.version !== entries[index].version
    )
      throw new ApiError(
        "entry_conflict",
        "This entry changed on another device.",
        409,
        { server: entries[index] },
      );
    const tags = readLocal<Tag[]>(LOCAL_TAGS_KEY, []);
    const tagIds = Array.isArray(changes.tagIds)
      ? (changes.tagIds as string[])
      : null;
    const selectedTags = tagIds
      ? tags.filter((tag) => tagIds.includes(tag.id))
      : entries[index].tags;
    const next = localAutoTags(
      {
        ...entries[index],
        ...changes,
        tags: selectedTags,
        pinnedAt:
          changes.pinned === true
            ? new Date().toISOString()
            : changes.pinned === false
              ? null
              : entries[index].pinnedAt,
        updatedAt: new Date().toISOString(),
        version: entries[index].version + 1,
      } as Entry,
      tags,
    );
    entries[index] = next;
    writeLocal(LOCAL_ENTRIES_KEY, entries);
    return next;
  }
  return (
    await remote<{ entry: Entry }>(`/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    })
  ).entry;
}

export async function getTags(): Promise<Tag[]> {
  if (isLocalMode) {
    seedLocal();
    return readLocal<Tag[]>(LOCAL_TAGS_KEY, []);
  }
  return (await remote<{ tags: Tag[] }>("/tags")).tags;
}

export async function saveTag(
  input: Partial<Tag> & { name: string },
): Promise<Tag[]> {
  if (isLocalMode) {
    const tags = readLocal<Tag[]>(LOCAL_TAGS_KEY, []);
    const normalized = input.name.replace(/^#+/, "").trim().toLocaleUpperCase();
    const now = new Date().toISOString();
    const existing = input.id
      ? tags.findIndex((tag) => tag.id === input.id)
      : -1;
    const tag: Tag = {
      id: input.id || crypto.randomUUID(),
      name: normalized,
      color: input.color || "#22d3aa",
      parentId: input.parentId || null,
      triggers: input.triggers || [],
      createdAt: existing >= 0 ? tags[existing].createdAt : now,
    };
    if (existing >= 0) tags[existing] = tag;
    else tags.push(tag);
    writeLocal(LOCAL_TAGS_KEY, tags);
    return tags.sort((a, b) => a.name.localeCompare(b.name));
  }
  const method = input.id ? "PATCH" : "POST";
  const path = input.id ? `/tags/${input.id}` : "/tags";
  return (
    await remote<{ tags: Tag[] }>(path, { method, body: JSON.stringify(input) })
  ).tags;
}

export async function deleteTag(id: string): Promise<void> {
  if (isLocalMode) {
    writeLocal(
      LOCAL_TAGS_KEY,
      readLocal<Tag[]>(LOCAL_TAGS_KEY, []).filter((tag) => tag.id !== id),
    );
    const entries = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []).map((entry) => ({
      ...entry,
      tags: entry.tags.filter((tag) => tag.id !== id),
    }));
    writeLocal(LOCAL_ENTRIES_KEY, entries);
    return;
  }
  await remote(`/tags/${id}`, { method: "DELETE", body: JSON.stringify({}) });
}

export async function addAttachment(
  entryId: string,
  file: File,
): Promise<Entry> {
  if (isLocalMode) {
    const entries = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []);
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) throw new ApiError("entry_not_found", "Entry not found.", 404);
    entry.attachments.push({
      id: crypto.randomUUID(),
      entryId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      createdAt: new Date().toISOString(),
    });
    writeLocal(LOCAL_ENTRIES_KEY, entries);
    return entry;
  }
  const form = new FormData();
  form.append("file", file);
  return (
    await remote<{ entry: Entry }>(`/entries/${entryId}/attachments`, {
      method: "POST",
      body: form,
    })
  ).entry;
}

export async function deleteAttachment(
  entryId: string,
  attachmentId: string,
): Promise<void> {
  if (isLocalMode) {
    const entries = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []);
    const entry = entries.find((item) => item.id === entryId);
    if (entry)
      entry.attachments = entry.attachments.filter(
        (item) => item.id !== attachmentId,
      );
    writeLocal(LOCAL_ENTRIES_KEY, entries);
    return;
  }
  await remote(
    `/entries/${encodeURIComponent(entryId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE", body: JSON.stringify({}) },
  );
}

export async function createClipToken(): Promise<string> {
  if (isLocalMode) return `mbc_local_${crypto.randomUUID()}`;
  return (
    await remote<{ token: string }>("/clip-tokens", {
      method: "POST",
      body: JSON.stringify({ name: "Chrome clipper" }),
    })
  ).token;
}

export async function subscribeToPush(
  subscription: PushSubscription,
): Promise<void> {
  if (isLocalMode) return;
  await remote("/push-subscriptions", {
    method: "POST",
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      deviceLabel: navigator.userAgent.includes("Android")
        ? "Android"
        : "Browser",
    }),
  });
}

export async function importEntries(
  entries: Array<
    EntryInput & {
      createdAt?: string;
      status?: EntryStatus;
      pinned?: boolean;
      tags?: string[];
    }
  >,
): Promise<{
  created: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
}> {
  if (isLocalMode) {
    let created = 0;
    for (const entry of entries) {
      await createEntry({
        ...entry,
        id: entry.id || crypto.randomUUID(),
        source: "mindchuk_import",
      });
      created += 1;
    }
    return { created, skipped: 0, errors: [] };
  }
  return remote("/import/mindchuk", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}

export function exportUrl(format: "csv" | "json"): string {
  if (!isLocalMode) return `/api/v1/exports/${format}`;
  const entries = readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []);
  const payload =
    format === "json"
      ? JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            entries,
            tags: readLocal<Tag[]>(LOCAL_TAGS_KEY, []),
          },
          null,
          2,
        )
      : [
          "id,kind,title,body,status,created_at",
          ...entries.map((entry) =>
            [
              entry.id,
              entry.kind,
              entry.title,
              entry.body,
              entry.status,
              entry.createdAt,
            ]
              .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
              .join(","),
          ),
        ].join("\r\n");
  return URL.createObjectURL(
    new Blob([payload], {
      type: format === "json" ? "application/json" : "text/csv",
    }),
  );
}

export async function downloadFullBackup(): Promise<void> {
  const backup = isLocalMode
    ? {
        exportedAt: new Date().toISOString(),
        timezone: "America/Phoenix",
        tags: readLocal<Tag[]>(LOCAL_TAGS_KEY, []),
        entries: readLocal<Entry[]>(LOCAL_ENTRIES_KEY, []),
      }
    : await remote<{
        exportedAt: string;
        timezone: string;
        tags: Tag[];
        entries: Entry[];
      }>("/exports/json");
  const files: Record<string, Uint8Array> = {
    "mindboss-backup.json": strToU8(JSON.stringify(backup, null, 2)),
  };
  if (!isLocalMode) {
    for (const entry of backup.entries) {
      for (const attachment of entry.attachments) {
        if (!attachment.url) continue;
        const response = await fetch(attachment.url, {
          credentials: "same-origin",
        });
        if (!response.ok)
          throw new ApiError(
            "backup_attachment_failed",
            `Could not include ${attachment.fileName} in the backup.`,
            response.status,
          );
        const safeName =
          attachment.fileName
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
            .slice(0, 180) || "attachment";
        files[`attachments/${entry.id}/${attachment.id}-${safeName}`] =
          new Uint8Array(await response.arrayBuffer());
      }
    }
  }
  const archive = zipSync(files, { level: 6 });
  const blob = new Blob([archive.slice().buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mindboss-full-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function logout(): Promise<void> {
  if (isLocalMode) return;
  await remote("/logout", { method: "POST", body: JSON.stringify({}) });
}
