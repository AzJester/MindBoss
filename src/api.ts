import type {
  CaptureTemplate,
  Entry,
  EntryFilters,
  EntryInput,
  EntryStatus,
  SavedSearch,
  Session,
  Tag,
  UserPreferences,
} from "../shared/types";
import { strToU8, zipSync } from "fflate";

const LOCAL_ENTRIES_KEY = "mindboss.local.entries";
const LOCAL_TAGS_KEY = "mindboss.local.tags";
const LOCAL_SEARCHES_KEY = "mindboss.local.saved-searches";
const LOCAL_TEMPLATES_KEY = "mindboss.local.templates";
const LOCAL_PREFERENCES_KEY = "mindboss.local.preferences";
const CSRF_KEY = "mindboss.csrf";
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
      recurrenceRule: null,
      reviewAt: null,
      lastViewedAt: null,
      viewCount: 0,
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
      recurrenceRule: null,
      reviewAt: null,
      lastViewedAt: null,
      viewCount: 0,
      createdAt: new Date(now - 90 * 60_000).toISOString(),
      updatedAt: new Date(now - 90 * 60_000).toISOString(),
      version: 1,
      listItems: [
        {
          id: crypto.randomUUID(),
          text: "Install Mind Boss on Android",
          position: 0,
          completedAt: new Date(now - 30 * 60_000).toISOString(),
          dueAt: null,
        },
        {
          id: crypto.randomUUID(),
          text: "Connect the Chrome clipper",
          position: 1,
          completedAt: null,
          dueAt: null,
        },
        {
          id: crypto.randomUUID(),
          text: "Import MindChuk notes",
          position: 2,
          completedAt: null,
          dueAt: null,
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
      recurrenceRule: null,
      reviewAt: null,
      lastViewedAt: null,
      viewCount: 0,
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
      recurrenceRule: null,
      reviewAt: null,
      lastViewedAt: null,
      viewCount: 0,
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
  const csrfToken =
    localStorage.getItem(CSRF_KEY) || sessionStorage.getItem(CSRF_KEY) || "";
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
    localStorage.setItem(CSRF_KEY, "local");
    sessionStorage.removeItem(CSRF_KEY);
    return session;
  }
  const session = await remote<Session>("/session");
  if (session.csrfToken) {
    localStorage.setItem(CSRF_KEY, session.csrfToken);
    sessionStorage.removeItem(CSRF_KEY);
  }
  return session;
}

export type EntryQuery = EntryFilters;

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
      .filter((entry) => !query.pinned || Boolean(entry.pinnedAt))
      .filter((entry) => !query.hasAttachments || entry.attachments.length > 0)
      .filter(
        (entry) =>
          !query.reminderState || entry.reminderState === query.reminderState,
      )
      .filter(
        (entry) => !query.from || entry.createdAt >= `${query.from}T00:00:00`,
      )
      .filter(
        (entry) => !query.to || entry.createdAt <= `${query.to}T23:59:59.999`,
      )
      .filter((entry) => {
        if (!query.due) return true;
        const dueValues = [
          entry.reminderAt,
          ...entry.listItems.map((item) => item.dueAt),
        ].filter(Boolean) as string[];
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return dueValues.some((value) => {
          const due = new Date(value);
          if (query.due === "today") return due >= start && due < end;
          if (query.due === "overdue") return due < start;
          return due >= end;
        });
      })
      .filter((entry) => {
        if (!query.review) return true;
        if (query.review === "due")
          return Boolean(
            entry.reviewAt && entry.reviewAt <= new Date().toISOString(),
          );
        return (
          !entry.lastViewedAt ||
          entry.lastViewedAt <
            new Date(Date.now() - 30 * 86_400_000).toISOString()
        );
      })
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
        recurrenceRule: input.recurrenceRule || null,
        reviewAt: input.reviewAt || null,
        lastViewedAt: null,
        viewCount: 0,
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
  extractedText = "",
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
      extractedText,
    });
    writeLocal(LOCAL_ENTRIES_KEY, entries);
    return entry;
  }
  const form = new FormData();
  form.append("file", file);
  if (extractedText) form.append("extractedText", extractedText);
  return (
    await remote<{ entry: Entry }>(`/entries/${entryId}/attachments`, {
      method: "POST",
      body: form,
    })
  ).entry;
}

export async function getSavedSearches(): Promise<SavedSearch[]> {
  if (isLocalMode) return readLocal<SavedSearch[]>(LOCAL_SEARCHES_KEY, []);
  return (await remote<{ savedSearches: SavedSearch[] }>("/saved-searches"))
    .savedSearches;
}

export async function saveSavedSearch(
  name: string,
  query: EntryFilters,
  id?: string,
): Promise<SavedSearch> {
  if (isLocalMode) {
    const searches = readLocal<SavedSearch[]>(LOCAL_SEARCHES_KEY, []);
    const index = id ? searches.findIndex((item) => item.id === id) : -1;
    const now = new Date().toISOString();
    const saved: SavedSearch = {
      id: id || crypto.randomUUID(),
      name: name.trim(),
      query,
      createdAt: index >= 0 ? searches[index].createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) searches[index] = saved;
    else searches.unshift(saved);
    writeLocal(LOCAL_SEARCHES_KEY, searches);
    return saved;
  }
  return (
    await remote<{ savedSearch: SavedSearch }>(
      id ? `/saved-searches/${id}` : "/saved-searches",
      {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({ name, query }),
      },
    )
  ).savedSearch;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  if (isLocalMode) {
    writeLocal(
      LOCAL_SEARCHES_KEY,
      readLocal<SavedSearch[]>(LOCAL_SEARCHES_KEY, []).filter(
        (item) => item.id !== id,
      ),
    );
    return;
  }
  await remote(`/saved-searches/${id}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

export async function getTemplates(): Promise<CaptureTemplate[]> {
  if (isLocalMode) return readLocal<CaptureTemplate[]>(LOCAL_TEMPLATES_KEY, []);
  return (await remote<{ templates: CaptureTemplate[] }>("/templates"))
    .templates;
}

export async function saveTemplate(
  input: Omit<CaptureTemplate, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
): Promise<CaptureTemplate> {
  if (isLocalMode) {
    const templates = readLocal<CaptureTemplate[]>(LOCAL_TEMPLATES_KEY, []);
    const index = input.id
      ? templates.findIndex((item) => item.id === input.id)
      : -1;
    const now = new Date().toISOString();
    const saved: CaptureTemplate = {
      ...input,
      id: input.id || crypto.randomUUID(),
      createdAt: index >= 0 ? templates[index].createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) templates[index] = saved;
    else templates.unshift(saved);
    writeLocal(LOCAL_TEMPLATES_KEY, templates);
    return saved;
  }
  return (
    await remote<{ template: CaptureTemplate }>(
      input.id ? `/templates/${input.id}` : "/templates",
      {
        method: input.id ? "PATCH" : "POST",
        body: JSON.stringify(input),
      },
    )
  ).template;
}

export async function deleteTemplate(id: string): Promise<void> {
  if (isLocalMode) {
    writeLocal(
      LOCAL_TEMPLATES_KEY,
      readLocal<CaptureTemplate[]>(LOCAL_TEMPLATES_KEY, []).filter(
        (item) => item.id !== id,
      ),
    );
    return;
  }
  await remote(`/templates/${id}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

const DEFAULT_PREFERENCES: UserPreferences = {
  onboarding: {},
  defaultCaptureKind: "note",
  quietStart: null,
  quietEnd: null,
  weeklyReviewDay: 0,
  viewMode: "feed",
  groupByTime: false,
  compactView: false,
  hideTagNav: false,
  theme: "dark",
  fontFamily: "system",
  displayTimezone: "America/Phoenix",
  boardTagIds: [],
  sortOrder: "newest",
};

export async function getPreferences(): Promise<UserPreferences> {
  if (isLocalMode) {
    const stored = readLocal<Partial<UserPreferences>>(
      LOCAL_PREFERENCES_KEY,
      {},
    );
    return {
      ...DEFAULT_PREFERENCES,
      ...stored,
      onboarding: { ...DEFAULT_PREFERENCES.onboarding, ...stored.onboarding },
    };
  }
  return (await remote<{ preferences: UserPreferences }>("/preferences"))
    .preferences;
}

export async function savePreferences(
  changes: Partial<UserPreferences>,
): Promise<UserPreferences> {
  if (isLocalMode) {
    const next = { ...(await getPreferences()), ...changes };
    writeLocal(LOCAL_PREFERENCES_KEY, next);
    return next;
  }
  return (
    await remote<{ preferences: UserPreferences }>("/preferences", {
      method: "PATCH",
      body: JSON.stringify(changes),
    })
  ).preferences;
}

export interface AiStatus {
  configured: boolean;
  model: string;
  reasoningEffort: string;
  dailyLimit: number;
  monthlyLimit: number;
  usedToday: number;
  usedThisMonth: number;
}

export async function getAiStatus(): Promise<AiStatus> {
  if (isLocalMode)
    return {
      configured: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      dailyLimit: 5,
      monthlyLimit: 50,
      usedToday: 0,
      usedThisMonth: 0,
    };
  return remote("/ai");
}

export async function runAi(input: {
  action:
    | "summarize"
    | "ask"
    | "suggest_tags"
    | "extract_actions"
    | "weekly_review"
    | "find_duplicates";
  request?: string;
  entries: Array<{ title: string; body: string; tags: string[] }>;
}): Promise<{ text: string; model: string; inputChars: number }> {
  if (isLocalMode)
    throw new ApiError(
      "ai_remote_required",
      "AI tools are available in the deployed private app.",
      400,
    );
  return remote("/ai", { method: "POST", body: JSON.stringify(input) });
}

export interface SmsStatus {
  configured: boolean;
  phoneNumber: string;
  webhookUrl: string;
  keywords: string[];
}

export async function getSmsStatus(): Promise<SmsStatus> {
  if (isLocalMode)
    return {
      configured: false,
      phoneNumber: "",
      webhookUrl: `${location.origin}/api/v1/sms/inbound`,
      keywords: ["NOTE", "IDEA", "LIST", "REMIND", "HELP"],
    };
  return remote("/sms/status");
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
  localStorage.removeItem(CSRF_KEY);
  sessionStorage.removeItem(CSRF_KEY);
}
