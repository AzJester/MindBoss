import type { Entry, EntryInput } from "../../../shared/types";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  normalizeTagName,
  normalizeWhitespace,
  validateEntryInput,
} from "../../../shared/validation";
import {
  addCors,
  encryptString,
  errorResponse,
  HttpError,
  json,
  listTags,
  loadAuth,
  loadEntry,
  nowIso,
  randomToken,
  recordEvent,
  requireAuth,
  requireMutationSecurity,
  sessionCookie,
  sha256,
  syncEntrySearch,
  applyAutomaticTags,
  type AuthContext,
  type Env,
} from "../_lib";
import {
  handleAi,
  handlePreferences,
  handleSavedSearches,
  handleTemplates,
} from "../features";

type ImportRecord = EntryInput & {
  createdAt?: string;
  status?: Entry["status"];
  pinned?: boolean;
  tags?: string[];
};

function routeParts(request: Request): string[] {
  return new URL(request.url).pathname
    .replace(/^\/api\/v1\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "Provide a valid JSON request body.",
    );
  }
}

function redirect(location: string, headers?: HeadersInit): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set("location", location);
  resultHeaders.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers: resultHeaders });
}

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function ftsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 12)
    .map((part) => `"${part.replace(/"/g, '""')}"*`)
    .join(" AND ");
}

function phoenixDayBounds(reference = new Date()): {
  start: string;
  end: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const start = new Date(
    Date.UTC(value("year"), value("month") - 1, value("day"), 7),
  );
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60_000).toISOString(),
  };
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message = ""): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${xml(message)}</Message>` : ""}</Response>`,
    { headers: { "content-type": "text/xml; charset=utf-8" } },
  );
}

export async function validTwilioSignature(
  token: string,
  signature: string,
  url: string,
  form: FormData,
): Promise<boolean> {
  const values: Array<readonly [string, string]> = [];
  form.forEach((value, key) => {
    if (typeof value === "string") values.push([key, value] as const);
  });
  values.sort(([left], [right]) => left.localeCompare(right));
  const payload = url + values.map(([key, value]) => `${key}${value}`).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1)
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

export function smsReminder(value: string): {
  body: string;
  reminderAt: string | null;
} {
  const match = value.match(
    /^((?:today|tomorrow)(?:\s+at)?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)\s*(?:\||-|:)\s*(.+)$/is,
  );
  if (!match) return { body: value, reminderAt: null };
  const when = match[1].trim().toLocaleLowerCase();
  let date: Date;
  if (when.startsWith("today") || when.startsWith("tomorrow")) {
    const time = when.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!time) return { body: match[2].trim(), reminderAt: null };
    let hour = Number(time[1]);
    if (time[3] === "pm" && hour < 12) hour += 12;
    if (time[3] === "am" && hour === 12) hour = 0;
    const phoenix = phoenixDayBounds();
    date = new Date(phoenix.start);
    if (when.startsWith("tomorrow")) date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(hour + 7, Number(time[2] || 0), 0, 0);
  } else {
    const parsed = when.includes("T") ? when : when.replace(" ", "T");
    date = new Date(
      `${parsed}${parsed.length > 10 ? ":00" : "T09:00:00"}-07:00`,
    );
  }
  return {
    body: match[2].trim(),
    reminderAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
  };
}

async function handleSmsInbound(env: Env, request: Request): Promise<Response> {
  if (!env.TWILIO_AUTH_TOKEN || !env.SMS_ALLOWED_FROM)
    throw new HttpError(
      503,
      "sms_not_configured",
      "SMS capture is not configured.",
    );
  const form = await request.formData();
  const signature = request.headers.get("x-twilio-signature") || "";
  if (
    !signature ||
    !(await validTwilioSignature(
      env.TWILIO_AUTH_TOKEN,
      signature,
      request.url,
      form,
    ))
  )
    throw new HttpError(
      403,
      "sms_signature_invalid",
      "SMS signature is invalid.",
    );
  const from = String(form.get("From") || "").trim();
  if (from !== env.SMS_ALLOWED_FROM.trim())
    throw new HttpError(
      403,
      "sms_sender_not_allowed",
      "SMS sender is not authorized.",
    );
  const messageSid = normalizeWhitespace(form.get("MessageSid"), 80);
  const raw = normalizeWhitespace(form.get("Body"), 10_000);
  if (!messageSid || !raw) return twiml();
  const existing = await env.DB.prepare(
    "SELECT message_sid FROM sms_messages WHERE message_sid = ?",
  )
    .bind(messageSid)
    .first();
  if (existing) return twiml();
  const allTags = await listTags(env, Number(env.ALLOWED_GITHUB_USER_ID));
  const command = raw.match(/^([\p{L}\p{N}_-]+)\b[:\s-]*(.*)$/isu);
  const candidate = (command?.[1] || "").toLocaleUpperCase();
  const builtIns = ["NOTE", "IDEA", "LIST", "REMIND", "HELP"];
  const keywordTag = allTags.find(
    (tag) =>
      normalizeTagName(tag.name) === normalizeTagName(candidate) ||
      tag.triggers.some(
        (trigger) => normalizeTagName(trigger) === normalizeTagName(candidate),
      ),
  );
  const keyword = builtIns.includes(candidate)
    ? candidate
    : keywordTag
      ? `TAG:${keywordTag.name}`
      : "NOTE";
  const content =
    builtIns.includes(candidate) || keywordTag ? command?.[2] || "" : raw;
  if (keyword === "HELP")
    return twiml(
      "Mind Boss: NOTE text | LIST item; item | REMIND tomorrow 9am | text. Add #TAG anywhere.",
    );
  const requestedNames = [...raw.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map(
    (match) => normalizeTagName(match[1]),
  );
  const tagIds = allTags
    .filter(
      (tag) =>
        tag.id === keywordTag?.id ||
        requestedNames.includes(normalizeTagName(tag.name)),
    )
    .map((tag) => tag.id);
  const cleanContent = content.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, " ").trim();
  const reminder = keyword === "REMIND" ? smsReminder(cleanContent) : null;
  const kind =
    keyword === "LIST" ? "list" : keyword === "REMIND" ? "reminder" : "note";
  const listItems =
    kind === "list"
      ? cleanContent
          .split(/(?:\r?\n|;)/)
          .map((text, position) => ({
            id: crypto.randomUUID(),
            text: text.replace(/^[-*\d.)\s]+/, "").trim(),
            position,
            completedAt: null,
            dueAt: null,
          }))
          .filter((item) => item.text)
      : [];
  const entry = await createEntry(env, Number(env.ALLOWED_GITHUB_USER_ID), {
    id: crypto.randomUUID(),
    kind,
    title: keyword === "IDEA" ? "Idea" : "",
    body: reminder?.body || (kind === "list" ? "" : cleanContent),
    source: "web",
    sourceTitle: `SMS · ${keyword}`,
    reminderAt: reminder?.reminderAt || null,
    tagIds,
    listItems,
  });
  await env.DB.prepare(
    "INSERT INTO sms_messages(message_sid, user_id, entry_id, from_number_hash, keyword, received_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      messageSid,
      Number(env.ALLOWED_GITHUB_USER_ID),
      entry.id,
      await sha256(from),
      keyword,
      nowIso(),
    )
    .run();
  return twiml();
}

async function handleOAuthStart(env: Env, request: Request): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID)
    throw new HttpError(
      503,
      "oauth_not_configured",
      "GitHub sign-in has not been configured yet.",
    );
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await sha256(verifier);
  const returnTo = safeReturnTo(
    new URL(request.url).searchParams.get("returnTo"),
  );
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(
      nowIso(),
    ),
    env.DB.prepare(
      "INSERT INTO oauth_states(state_hash, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(await sha256(state), verifier, returnTo, expiresAt),
  ]);
  const callback = `${env.APP_ORIGIN}/api/v1/auth/github/callback`;
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  target.searchParams.set("redirect_uri", callback);
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "S256");
  target.searchParams.set("allow_signup", "false");
  return redirect(target.toString());
}

async function handleOAuthCallback(
  env: Env,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    throw new HttpError(
      400,
      "oauth_callback_invalid",
      "GitHub did not return a valid authorization response.",
    );
  const stateHash = await sha256(state);
  const record = await env.DB.prepare(
    "SELECT code_verifier, return_to, expires_at FROM oauth_states WHERE state_hash = ?",
  )
    .bind(stateHash)
    .first<{ code_verifier: string; return_to: string; expires_at: string }>();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?")
    .bind(stateHash)
    .run();
  if (!record || record.expires_at <= nowIso())
    throw new HttpError(
      400,
      "oauth_state_invalid",
      "This sign-in attempt expired. Start again.",
    );

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "MindBoss",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${env.APP_ORIGIN}/api/v1/auth/github/callback`,
        code_verifier: record.code_verifier,
      }),
    },
  );
  const tokenBody = await tokenResponse.json<Record<string, string>>();
  if (!tokenResponse.ok || !tokenBody.access_token)
    throw new HttpError(
      401,
      "oauth_exchange_failed",
      "GitHub sign-in could not be completed.",
    );

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${tokenBody.access_token}`,
      "user-agent": "MindBoss",
    },
  });
  const githubUser = await userResponse.json<{
    id?: number;
    login?: string;
    avatar_url?: string;
  }>();
  if (!userResponse.ok || !githubUser.id || !githubUser.login)
    throw new HttpError(
      401,
      "github_identity_failed",
      "GitHub identity could not be verified.",
    );
  if (String(githubUser.id) !== env.ALLOWED_GITHUB_USER_ID)
    throw new HttpError(
      403,
      "account_not_allowed",
      "This GitHub account is not authorized for Mind Boss.",
    );

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users(id, login, avatar_url, timezone, created_at, updated_at) VALUES (?, ?, ?, 'America/Phoenix', ?, ?)
     ON CONFLICT(id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
  )
    .bind(
      githubUser.id,
      githubUser.login,
      githubUser.avatar_url || "",
      now,
      now,
    )
    .run();
  const rawSession = randomToken(32);
  const tokenHash = await sha256(`${rawSession}:${env.SESSION_SECRET}`);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(tokenHash, githubUser.id, csrfToken, now, expiresAt, now)
    .run();
  return redirect(`${env.APP_ORIGIN}${safeReturnTo(record.return_to)}`, {
    "set-cookie": sessionCookie(rawSession),
  });
}

async function createEntry(
  env: Env,
  userId: number,
  inputValue: unknown,
  options: {
    createdAt?: string;
    status?: Entry["status"];
    importHash?: string;
  } = {},
): Promise<Entry> {
  let input: EntryInput;
  try {
    input = validateEntryInput(inputValue);
  } catch (error) {
    throw new HttpError(
      400,
      "entry_invalid",
      error instanceof Error ? error.message : "Entry is invalid.",
    );
  }
  const existing = await loadEntry(env, userId, input.id);
  if (existing) return existing;
  const now = nowIso();
  const createdAt =
    options.createdAt && !Number.isNaN(Date.parse(options.createdAt))
      ? new Date(options.createdAt).toISOString()
      : now;
  const status =
    options.status && ["active", "archived", "trashed"].includes(options.status)
      ? options.status
      : "active";
  const reminderState = input.reminderAt ? "pending" : null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO entries(id, user_id, kind, title, body, source, source_url, source_title, status, reminder_at, reminder_state, recurrence_rule, review_at, import_hash, deleted_at, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).bind(
      input.id,
      userId,
      input.kind,
      input.title || "",
      input.body || "",
      input.source || "web",
      input.sourceUrl || null,
      input.sourceTitle || null,
      status,
      input.reminderAt || null,
      reminderState,
      input.recurrenceRule || null,
      input.reviewAt || null,
      options.importHash || null,
      status === "trashed" ? now : null,
      createdAt,
      now,
    ),
  ];
  for (const item of input.listItems || []) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO list_items(id, entry_id, text, position, completed_at, due_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(
        item.id,
        input.id,
        item.text,
        item.position,
        item.completedAt,
        item.dueAt,
      ),
    );
  }
  for (const tagId of input.tagIds || []) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO entry_tags(entry_id, tag_id, source, created_at)
       SELECT ?, id, 'manual', ? FROM tags WHERE id = ? AND user_id = ?
       ON CONFLICT(entry_id, tag_id) DO NOTHING`,
      ).bind(input.id, now, tagId, userId),
    );
  }
  await env.DB.batch(statements);
  const searchable = [
    input.title,
    input.body,
    input.sourceTitle,
    input.sourceUrl,
    ...(input.listItems || []).map((item) => item.text),
  ]
    .filter(Boolean)
    .join("\n");
  await applyAutomaticTags(env, userId, input.id, searchable);
  await syncEntrySearch(env, input.id);
  await recordEvent(env, userId, input.id, "created", {
    source: input.source || "web",
  });
  return (await loadEntry(env, userId, input.id))!;
}

async function listEntries(
  env: Env,
  userId: number,
  request: Request,
): Promise<Entry[]> {
  const params = new URL(request.url).searchParams;
  const where = ["e.user_id = ?"];
  const values: unknown[] = [userId];
  const q = normalizeWhitespace(params.get("q"), 200);
  let from = "entries e";
  if (q) {
    from += " JOIN entries_fts ON entries_fts.entry_id = e.id";
    where.push("entries_fts MATCH ?");
    values.push(ftsQuery(q));
  }
  const status = params.get("status") || "active";
  if (["active", "archived", "trashed"].includes(status)) {
    where.push("e.status = ?");
    values.push(status);
  }
  const kind = params.get("kind");
  if (kind && ["note", "list", "reminder"].includes(kind)) {
    where.push("e.kind = ?");
    values.push(kind);
  }
  const tagId = params.get("tag");
  if (tagId) {
    where.push(
      "EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id = ?)",
    );
    values.push(tagId);
  }
  if (params.get("pinned") === "true") where.push("e.pinned_at IS NOT NULL");
  if (params.get("hasAttachments") === "true")
    where.push("EXISTS (SELECT 1 FROM attachments a WHERE a.entry_id = e.id)");
  const reminderState = params.get("reminderState");
  if (
    reminderState &&
    ["pending", "delivered", "completed"].includes(reminderState)
  ) {
    where.push("e.reminder_state = ?");
    values.push(reminderState);
  }
  const fromDate = params.get("from");
  const toDate = params.get("to");
  if (fromDate && !Number.isNaN(Date.parse(fromDate))) {
    where.push("e.created_at >= ?");
    values.push(new Date(fromDate).toISOString());
  }
  if (toDate && !Number.isNaN(Date.parse(toDate))) {
    where.push("e.created_at <= ?");
    values.push(new Date(toDate).toISOString());
  }
  const due = params.get("due");
  if (due) {
    const bounds = phoenixDayBounds();
    if (due === "today") {
      where.push(
        `((e.reminder_at >= ? AND e.reminder_at < ? AND e.reminder_state != 'completed') OR
          EXISTS (SELECT 1 FROM list_items due_item WHERE due_item.entry_id = e.id AND due_item.completed_at IS NULL AND due_item.due_at >= ? AND due_item.due_at < ?))`,
      );
      values.push(bounds.start, bounds.end, bounds.start, bounds.end);
    } else if (due === "overdue") {
      where.push(
        `((e.reminder_at < ? AND e.reminder_state != 'completed') OR
          EXISTS (SELECT 1 FROM list_items due_item WHERE due_item.entry_id = e.id AND due_item.completed_at IS NULL AND due_item.due_at < ?))`,
      );
      values.push(bounds.start, bounds.start);
    } else if (due === "upcoming") {
      where.push(
        `((e.reminder_at >= ? AND e.reminder_state != 'completed') OR
          EXISTS (SELECT 1 FROM list_items due_item WHERE due_item.entry_id = e.id AND due_item.completed_at IS NULL AND due_item.due_at >= ?))`,
      );
      values.push(bounds.end, bounds.end);
    }
  }
  const review = params.get("review");
  if (review === "due") {
    where.push("e.review_at IS NOT NULL AND e.review_at <= ?");
    values.push(nowIso());
  } else if (review === "stale") {
    where.push(
      "COALESCE(e.last_viewed_at, e.updated_at) <= ? AND e.status = 'active'",
    );
    values.push(new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString());
  }
  const direction = params.get("sort") === "oldest" ? "ASC" : "DESC";
  const rows = await env.DB.prepare(
    `SELECT DISTINCT e.id FROM ${from} WHERE ${where.join(" AND ")}
     ORDER BY (e.pinned_at IS NOT NULL) DESC, e.pinned_at DESC, e.created_at ${direction} LIMIT 250`,
  )
    .bind(...values)
    .all<{ id: string }>();
  return (
    await Promise.all(rows.results.map((row) => loadEntry(env, userId, row.id)))
  ).filter((entry): entry is Entry => Boolean(entry));
}

async function updateEntry(
  env: Env,
  auth: AuthContext,
  entryId: string,
  body: Record<string, unknown>,
): Promise<Entry> {
  const existing = await loadEntry(env, auth.user.id, entryId);
  if (!existing)
    throw new HttpError(404, "entry_not_found", "Entry not found.");
  if (Number(body.version) !== existing.version)
    throw new HttpError(
      409,
      "entry_conflict",
      "This entry changed on another device.",
      { server: existing },
    );
  const inputValue = {
    id: entryId,
    kind: body.kind ?? existing.kind,
    title: body.title ?? existing.title,
    body: body.body ?? existing.body,
    source: existing.source,
    sourceUrl: body.sourceUrl ?? existing.sourceUrl,
    sourceTitle: body.sourceTitle ?? existing.sourceTitle,
    reminderAt: Object.prototype.hasOwnProperty.call(body, "reminderAt")
      ? body.reminderAt
      : existing.reminderAt,
    recurrenceRule: Object.prototype.hasOwnProperty.call(body, "recurrenceRule")
      ? body.recurrenceRule
      : existing.recurrenceRule,
    reviewAt: Object.prototype.hasOwnProperty.call(body, "reviewAt")
      ? body.reviewAt
      : existing.reviewAt,
    tagIds: Array.isArray(body.tagIds)
      ? body.tagIds
      : existing.tags.map((tag) => tag.id),
    listItems: Array.isArray(body.listItems)
      ? body.listItems
      : existing.listItems,
  };
  let input: EntryInput;
  try {
    input = validateEntryInput(inputValue);
  } catch (error) {
    throw new HttpError(
      400,
      "entry_invalid",
      error instanceof Error ? error.message : "Entry is invalid.",
    );
  }
  const status =
    typeof body.status === "string" &&
    ["active", "archived", "trashed"].includes(body.status)
      ? body.status
      : existing.status;
  const pinnedAt =
    body.pinned === true
      ? existing.pinnedAt || nowIso()
      : body.pinned === false
        ? null
        : existing.pinnedAt;
  const reminderState =
    typeof body.reminderState === "string" &&
    ["pending", "delivered", "completed"].includes(body.reminderState)
      ? body.reminderState
      : input.reminderAt
        ? existing.reminderState || "pending"
        : null;
  const updated = nowIso();
  const result = await env.DB.prepare(
    `UPDATE entries SET kind = ?, title = ?, body = ?, source_url = ?, source_title = ?, status = ?, pinned_at = ?, reminder_at = ?, reminder_state = ?,
     recurrence_rule = ?, review_at = ?, deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND version = ?`,
  )
    .bind(
      input.kind,
      input.title || "",
      input.body || "",
      input.sourceUrl || null,
      input.sourceTitle || null,
      status,
      pinnedAt,
      input.reminderAt || null,
      reminderState,
      input.recurrenceRule || null,
      input.reviewAt || null,
      status === "trashed"
        ? existing.status === "trashed"
          ? existing.updatedAt
          : updated
        : null,
      updated,
      entryId,
      auth.user.id,
      existing.version,
    )
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      "entry_conflict",
      "This entry changed on another device.",
    );

  if (Array.isArray(body.listItems)) {
    const itemStatements: D1PreparedStatement[] = [
      env.DB.prepare("DELETE FROM list_items WHERE entry_id = ?").bind(entryId),
    ];
    for (const item of input.listItems || [])
      itemStatements.push(
        env.DB.prepare(
          "INSERT INTO list_items(id, entry_id, text, position, completed_at, due_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          item.id,
          entryId,
          item.text,
          item.position,
          item.completedAt,
          item.dueAt,
        ),
      );
    await env.DB.batch(itemStatements);
  }
  if (Array.isArray(body.tagIds)) {
    const tagStatements: D1PreparedStatement[] = [
      env.DB.prepare(
        "DELETE FROM entry_tags WHERE entry_id = ? AND source = 'manual'",
      ).bind(entryId),
    ];
    for (const tagId of input.tagIds || [])
      tagStatements.push(
        env.DB.prepare(
          `INSERT INTO entry_tags(entry_id, tag_id, source, created_at) SELECT ?, id, 'manual', ? FROM tags WHERE id = ? AND user_id = ?
       ON CONFLICT(entry_id, tag_id) DO UPDATE SET source = CASE WHEN entry_tags.source = 'import' THEN 'manual' ELSE entry_tags.source END`,
        ).bind(entryId, updated, tagId, auth.user.id),
      );
    await env.DB.batch(tagStatements);
  }
  const searchable = [
    input.title,
    input.body,
    input.sourceTitle,
    input.sourceUrl,
    ...(input.listItems || []).map((item) => item.text),
  ]
    .filter(Boolean)
    .join("\n");
  await applyAutomaticTags(env, auth.user.id, entryId, searchable);
  await syncEntrySearch(env, entryId);
  await recordEvent(
    env,
    auth.user.id,
    entryId,
    existing.status !== status ? status : "updated",
  );
  return (await loadEntry(env, auth.user.id, entryId))!;
}

async function deleteEntryPermanently(
  env: Env,
  auth: AuthContext,
  entryId: string,
  version: number,
): Promise<void> {
  const existing = await loadEntry(env, auth.user.id, entryId);
  if (!existing)
    throw new HttpError(404, "entry_not_found", "Entry not found.");
  if (existing.status !== "trashed")
    throw new HttpError(
      409,
      "entry_not_trashed",
      "Only entries in Trash can be permanently deleted.",
    );
  if (!Number.isInteger(version) || version !== existing.version)
    throw new HttpError(
      409,
      "entry_conflict",
      "This entry changed on another device.",
      { server: existing },
    );

  const attachments = await env.DB.prepare(
    "SELECT r2_key FROM attachments WHERE entry_id = ?",
  )
    .bind(entryId)
    .all<{ r2_key: string }>();
  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM entries_fts WHERE entry_id IN (
        SELECT id FROM entries WHERE id = ? AND user_id = ? AND status = 'trashed' AND version = ?
      )`,
    ).bind(entryId, auth.user.id, version),
    env.DB.prepare(
      "DELETE FROM entries WHERE id = ? AND user_id = ? AND status = 'trashed' AND version = ?",
    ).bind(entryId, auth.user.id, version),
  ]);
  if (!results[1]?.meta.changes)
    throw new HttpError(
      409,
      "entry_conflict",
      "This entry changed on another device.",
    );
  if (attachments.results.length)
    await env.ATTACHMENTS.delete(
      attachments.results.map((attachment) => attachment.r2_key),
    );
}

function validColor(value: unknown): string {
  const color = typeof value === "string" ? value : "#22d3aa";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#22d3aa";
}

async function replaceTagTriggers(
  env: Env,
  tagId: string,
  triggers: unknown,
): Promise<void> {
  const values = Array.isArray(triggers)
    ? [
        ...new Set(
          triggers.map((item) => normalizeWhitespace(item, 60)).filter(Boolean),
        ),
      ].slice(0, 20)
    : [];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM tag_triggers WHERE tag_id = ?").bind(tagId),
  ];
  for (const trigger of values)
    statements.push(
      env.DB.prepare(
        "INSERT INTO tag_triggers(id, tag_id, trigger_text, normalized_trigger) VALUES (?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        tagId,
        trigger,
        trigger.toLocaleLowerCase("en-US"),
      ),
    );
  await env.DB.batch(statements);
}

async function handleTags(
  env: Env,
  auth: AuthContext,
  request: Request,
  parts: string[],
): Promise<Response> {
  if (request.method === "GET" && parts.length === 1)
    return json({ tags: await listTags(env, auth.user.id) });
  requireMutationSecurity(env, request, auth);
  const body = await requestJson(request);
  if (request.method === "POST" && parts.length === 1) {
    const name = normalizeTagName(body.name);
    if (!name) throw new HttpError(400, "tag_invalid", "Enter a tag name.");
    const id = typeof body.id === "string" ? body.id : crypto.randomUUID();
    const parentId = typeof body.parentId === "string" ? body.parentId : null;
    if (parentId) {
      const parent = await env.DB.prepare(
        "SELECT parent_id FROM tags WHERE id = ? AND user_id = ?",
      )
        .bind(parentId, auth.user.id)
        .first<{ parent_id: string | null }>();
      if (!parent)
        throw new HttpError(
          400,
          "tag_parent_invalid",
          "The parent tag does not exist.",
        );
      if (parent.parent_id)
        throw new HttpError(
          400,
          "tag_depth_invalid",
          "Mind Boss supports one level of nested tags.",
        );
    }
    const now = nowIso();
    try {
      await env.DB.prepare(
        "INSERT INTO tags(id, user_id, name, normalized_name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          auth.user.id,
          name,
          name,
          validColor(body.color),
          parentId,
          now,
          now,
        )
        .run();
    } catch {
      throw new HttpError(
        409,
        "tag_exists",
        "A tag with that name already exists.",
      );
    }
    await replaceTagTriggers(env, id, body.triggers);
    return json({ tags: await listTags(env, auth.user.id) }, { status: 201 });
  }
  const tagId = parts[1];
  if (!tagId) throw new HttpError(404, "tag_not_found", "Tag not found.");
  if (request.method === "PATCH") {
    const current = await env.DB.prepare(
      "SELECT * FROM tags WHERE id = ? AND user_id = ?",
    )
      .bind(tagId, auth.user.id)
      .first<Record<string, unknown>>();
    if (!current) throw new HttpError(404, "tag_not_found", "Tag not found.");
    const name = Object.prototype.hasOwnProperty.call(body, "name")
      ? normalizeTagName(body.name)
      : String(current.name);
    const parentId = Object.prototype.hasOwnProperty.call(body, "parentId")
      ? typeof body.parentId === "string"
        ? body.parentId
        : null
      : current.parent_id
        ? String(current.parent_id)
        : null;
    if (parentId === tagId)
      throw new HttpError(
        400,
        "tag_parent_invalid",
        "A tag cannot contain itself.",
      );
    if (parentId) {
      const parent = await env.DB.prepare(
        "SELECT parent_id FROM tags WHERE id = ? AND user_id = ?",
      )
        .bind(parentId, auth.user.id)
        .first<{ parent_id: string | null }>();
      if (!parent)
        throw new HttpError(
          400,
          "tag_parent_invalid",
          "The parent tag does not exist.",
        );
      if (parent.parent_id)
        throw new HttpError(
          400,
          "tag_depth_invalid",
          "Mind Boss supports one level of nested tags.",
        );
      const children = await env.DB.prepare(
        "SELECT 1 AS found FROM tags WHERE parent_id = ? AND user_id = ? LIMIT 1",
      )
        .bind(tagId, auth.user.id)
        .first();
      if (children)
        throw new HttpError(
          400,
          "tag_depth_invalid",
          "A tag with child tags cannot be nested.",
        );
    }
    await env.DB.prepare(
      "UPDATE tags SET name = ?, normalized_name = ?, color = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
      .bind(
        name,
        name,
        Object.prototype.hasOwnProperty.call(body, "color")
          ? validColor(body.color)
          : current.color,
        parentId,
        nowIso(),
        tagId,
        auth.user.id,
      )
      .run();
    if (Object.prototype.hasOwnProperty.call(body, "triggers"))
      await replaceTagTriggers(env, tagId, body.triggers);
    return json({ tags: await listTags(env, auth.user.id) });
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?")
      .bind(tagId, auth.user.id)
      .run();
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, "method_not_allowed", "Method not allowed.");
}

function detectMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(4, 8).startsWith("ftyphei") || ascii(4, 8).startsWith("ftypmif"))
    return "image/heic";
  return null;
}

function safeFileName(value: string): string {
  return (
    value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) ||
    "attachment"
  );
}

async function handleAttachments(
  env: Env,
  auth: AuthContext,
  request: Request,
  parts: string[],
): Promise<Response> {
  const entryId = parts[1];
  const entry = entryId ? await loadEntry(env, auth.user.id, entryId) : null;
  if (!entry) throw new HttpError(404, "entry_not_found", "Entry not found.");
  const attachmentId = parts[3];
  if (request.method === "GET" && !attachmentId)
    return json({ attachments: entry.attachments });
  if (request.method === "GET" && attachmentId) {
    const row = await env.DB.prepare(
      "SELECT * FROM attachments WHERE id = ? AND entry_id = ?",
    )
      .bind(attachmentId, entryId)
      .first<Record<string, unknown>>();
    if (!row)
      throw new HttpError(404, "attachment_not_found", "Attachment not found.");
    const object = await env.ATTACHMENTS.get(String(row.r2_key));
    if (!object)
      throw new HttpError(
        404,
        "attachment_missing",
        "The attachment file is missing.",
      );
    const headers = new Headers();
    headers.set("content-type", String(row.mime_type));
    headers.set("content-length", String(row.size_bytes));
    headers.set(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(String(row.file_name))}`,
    );
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }
  requireMutationSecurity(env, request, auth);
  if (request.method === "POST" && !attachmentId) {
    if (entry.attachments.length >= MAX_ATTACHMENTS)
      throw new HttpError(
        400,
        "attachment_limit",
        `Each entry can have up to ${MAX_ATTACHMENTS} attachments.`,
      );
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new HttpError(400, "file_required", "Choose an image or PDF.");
    const extractedText = normalizeWhitespace(
      form.get("extractedText"),
      100_000,
    );
    if (file.size > MAX_ATTACHMENT_BYTES)
      throw new HttpError(
        413,
        "file_too_large",
        "Attachments must be 20 MB or smaller.",
      );
    const data = await file.arrayBuffer();
    const mime = detectMime(new Uint8Array(data));
    if (!mime)
      throw new HttpError(
        415,
        "file_type_invalid",
        "Mind Boss accepts PNG, JPEG, GIF, WebP, HEIC, and PDF files.",
      );
    const contentHash = await sha256(data);
    const duplicate = await env.DB.prepare(
      "SELECT id FROM attachments WHERE entry_id = ? AND sha256 = ?",
    )
      .bind(entryId, contentHash)
      .first();
    if (duplicate) return json({ entry });
    const id = crypto.randomUUID();
    const key = `${auth.user.id}/${entryId}/${id}`;
    await env.ATTACHMENTS.put(key, data, {
      httpMetadata: { contentType: mime },
      customMetadata: { entryId },
    });
    await env.DB.prepare(
      "INSERT INTO attachments(id, entry_id, r2_key, file_name, mime_type, size_bytes, sha256, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        entryId,
        key,
        safeFileName(file.name),
        mime,
        file.size,
        contentHash,
        extractedText,
        nowIso(),
      )
      .run();
    await syncEntrySearch(env, entryId);
    await recordEvent(env, auth.user.id, entryId, "attachment_added", {
      attachmentId: id,
      mimeType: mime,
      size: file.size,
    });
    return json(
      { entry: await loadEntry(env, auth.user.id, entryId) },
      { status: 201 },
    );
  }
  if (request.method === "DELETE" && attachmentId) {
    const row = await env.DB.prepare(
      "SELECT r2_key FROM attachments WHERE id = ? AND entry_id = ?",
    )
      .bind(attachmentId, entryId)
      .first<{ r2_key: string }>();
    if (!row)
      throw new HttpError(404, "attachment_not_found", "Attachment not found.");
    await env.ATTACHMENTS.delete(row.r2_key);
    await env.DB.prepare(
      "DELETE FROM attachments WHERE id = ? AND entry_id = ?",
    )
      .bind(attachmentId, entryId)
      .run();
    await syncEntrySearch(env, entryId);
    await recordEvent(env, auth.user.id, entryId, "attachment_removed", {
      attachmentId,
    });
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, "method_not_allowed", "Method not allowed.");
}

async function handleClipTokens(
  env: Env,
  auth: AuthContext,
  request: Request,
  parts: string[],
): Promise<Response> {
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, name, created_at, last_used_at, revoked_at FROM clip_tokens WHERE user_id = ? ORDER BY created_at DESC",
    )
      .bind(auth.user.id)
      .all<Record<string, unknown>>();
    return json({
      tokens: rows.results.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
      })),
    });
  }
  requireMutationSecurity(env, request, auth);
  if (request.method === "POST") {
    const body = await requestJson(request);
    const name = normalizeWhitespace(body.name, 80) || "Chrome clipper";
    const raw = `mbc_${randomToken(32)}`;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO clip_tokens(id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(id, auth.user.id, name, await sha256(raw), nowIso())
      .run();
    return json(
      {
        token: raw,
        record: {
          id,
          name,
          createdAt: nowIso(),
          lastUsedAt: null,
          revokedAt: null,
        },
      },
      { status: 201 },
    );
  }
  if (request.method === "DELETE" && parts[1]) {
    await env.DB.prepare(
      "UPDATE clip_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?",
    )
      .bind(nowIso(), parts[1], auth.user.id)
      .run();
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, "method_not_allowed", "Method not allowed.");
}

async function handleClip(env: Env, request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer mbc_"))
    throw new HttpError(
      401,
      "clip_token_required",
      "Connect the Mind Boss Chrome clipper first.",
    );
  const tokenHash = await sha256(authorization.slice(7));
  const token = await env.DB.prepare(
    "SELECT id, user_id FROM clip_tokens WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: number }>();
  if (!token)
    throw new HttpError(
      401,
      "clip_token_invalid",
      "This clipper token is invalid or revoked.",
    );
  const body = await requestJson(request);
  const tagIds: string[] = [];
  if (Array.isArray(body.tagNames)) {
    for (const rawTag of body.tagNames.slice(0, 20)) {
      const name = normalizeTagName(rawTag);
      if (!name) continue;
      let tag = await env.DB.prepare(
        "SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?",
      )
        .bind(token.user_id, name)
        .first<{ id: string }>();
      if (!tag) {
        const id = crypto.randomUUID();
        const now = nowIso();
        await env.DB.prepare(
          "INSERT INTO tags(id, user_id, name, normalized_name, color, created_at, updated_at) VALUES (?, ?, ?, ?, '#22d3aa', ?, ?)",
        )
          .bind(id, token.user_id, name, name, now, now)
          .run();
        tag = { id };
      }
      tagIds.push(tag.id);
    }
  }
  const entry = await createEntry(env, token.user_id, {
    ...body,
    tagIds,
    source: "chrome_extension",
  });
  await env.DB.prepare("UPDATE clip_tokens SET last_used_at = ? WHERE id = ?")
    .bind(nowIso(), token.id)
    .run();
  return json({ entry }, { status: 201 });
}

async function handleImport(
  env: Env,
  auth: AuthContext,
  request: Request,
): Promise<Response> {
  requireMutationSecurity(env, request, auth);
  const body = await requestJson(request);
  if (!Array.isArray(body.entries))
    throw new HttpError(
      400,
      "import_invalid",
      "Provide a normalized entries array.",
    );
  if (body.entries.length > 100)
    throw new HttpError(
      400,
      "import_batch_too_large",
      "Import at most 100 entries per batch.",
    );
  let created = 0;
  let skipped = 0;
  const errors: Array<{ index: number; message: string }> = [];
  for (const [index, raw] of (body.entries as ImportRecord[]).entries()) {
    try {
      const record = raw as ImportRecord;
      const importHash = await sha256(
        JSON.stringify([
          normalizeWhitespace(record.title, 500).toLocaleLowerCase("en-US"),
          normalizeWhitespace(record.body).toLocaleLowerCase("en-US"),
          record.createdAt ? new Date(record.createdAt).toISOString() : "",
        ]),
      );
      const duplicate = await env.DB.prepare(
        "SELECT id FROM entries WHERE user_id = ? AND import_hash = ?",
      )
        .bind(auth.user.id, importHash)
        .first();
      if (duplicate) {
        skipped += 1;
        continue;
      }
      const tagIds: string[] = [];
      for (const rawTag of record.tags || []) {
        const name = normalizeTagName(rawTag);
        if (!name) continue;
        let tag = await env.DB.prepare(
          "SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?",
        )
          .bind(auth.user.id, name)
          .first<{ id: string }>();
        if (!tag) {
          const id = crypto.randomUUID();
          const now = nowIso();
          await env.DB.prepare(
            "INSERT INTO tags(id, user_id, name, normalized_name, color, created_at, updated_at) VALUES (?, ?, ?, ?, '#22d3aa', ?, ?)",
          )
            .bind(id, auth.user.id, name, name, now, now)
            .run();
          tag = { id };
        }
        tagIds.push(tag.id);
      }
      const entryId = record.id || crypto.randomUUID();
      await createEntry(
        env,
        auth.user.id,
        { ...record, id: entryId, source: "mindchuk_import", tagIds },
        {
          createdAt: record.createdAt,
          status: record.status,
          importHash,
        },
      );
      if (record.pinned)
        await env.DB.prepare(
          "UPDATE entries SET pinned_at = ? WHERE id = ? AND user_id = ?",
        )
          .bind(record.createdAt || nowIso(), entryId, auth.user.id)
          .run();
      created += 1;
    } catch (error) {
      errors.push({
        index,
        message: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }
  return json({ created, skipped, errors });
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function handleExport(
  env: Env,
  auth: AuthContext,
  format: string,
): Promise<Response> {
  const entries = await listEntries(
    env,
    auth.user.id,
    new Request(`${env.APP_ORIGIN}/api/v1/entries?status=active`),
  );
  const archived = await listEntries(
    env,
    auth.user.id,
    new Request(`${env.APP_ORIGIN}/api/v1/entries?status=archived`),
  );
  const trashed = await listEntries(
    env,
    auth.user.id,
    new Request(`${env.APP_ORIGIN}/api/v1/entries?status=trashed`),
  );
  const all = [...entries, ...archived, ...trashed];
  if (format === "json")
    return json({
      exportedAt: nowIso(),
      timezone: auth.user.timezone,
      tags: await listTags(env, auth.user.id),
      entries: all,
    });
  if (format === "csv") {
    const headings = [
      "id",
      "kind",
      "title",
      "body",
      "source_url",
      "status",
      "pinned",
      "reminder_at",
      "tags",
      "list_items",
      "created_at",
      "updated_at",
    ];
    const rows = all.map((entry) => [
      entry.id,
      entry.kind,
      entry.title,
      entry.body,
      entry.sourceUrl || "",
      entry.status,
      Boolean(entry.pinnedAt),
      entry.reminderAt || "",
      entry.tags.map((tag) => tag.name).join("|"),
      JSON.stringify(entry.listItems),
      entry.createdAt,
      entry.updatedAt,
    ]);
    const csv = [headings, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mindboss-${nowIso().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  throw new HttpError(404, "export_not_found", "Export format not found.");
}

async function handleRequest(env: Env, request: Request): Promise<Response> {
  const parts = routeParts(request);
  if (request.method === "OPTIONS")
    return addCors(env, request, new Response(null, { status: 204 }));
  if (parts[0] === "health" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT 1 AS ready").first<{
      ready: number;
    }>();
    return json({
      ok: result?.ready === 1,
      service: "mindboss",
      time: nowIso(),
    });
  }
  if (
    parts[0] === "auth" &&
    parts[1] === "github" &&
    !parts[2] &&
    request.method === "GET"
  )
    return handleOAuthStart(env, request);
  if (
    parts[0] === "auth" &&
    parts[1] === "github" &&
    parts[2] === "callback" &&
    request.method === "GET"
  )
    return handleOAuthCallback(env, request);
  if (parts[0] === "clips" && request.method === "POST")
    return addCors(env, request, await handleClip(env, request));
  if (parts[0] === "sms" && parts[1] === "inbound" && request.method === "POST")
    return handleSmsInbound(env, request);

  const auth = await loadAuth(env, request);
  if (parts[0] === "session" && request.method === "GET") {
    if (!auth) return json({ authenticated: false });
    await env.DB.prepare(
      "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
    )
      .bind(nowIso(), auth.tokenHash)
      .run();
    return json({
      authenticated: true,
      csrfToken: auth.csrfToken,
      user: {
        id: auth.user.id,
        login: auth.user.login,
        avatarUrl: auth.user.avatarUrl,
      },
    });
  }
  const current = requireAuth(auth);
  if (parts[0] === "logout" && request.method === "POST") {
    requireMutationSecurity(env, request, current);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(current.tokenHash)
      .run();
    return json(
      { ok: true },
      { headers: { "set-cookie": sessionCookie("", 0) } },
    );
  }
  if (parts[0] === "entries") {
    if (parts[2] === "attachments")
      return handleAttachments(env, current, request, parts);
    if (request.method === "GET" && parts.length === 1)
      return json({
        entries: await listEntries(env, current.user.id, request),
      });
    if (request.method === "GET" && parts[1]) {
      let entry = await loadEntry(env, current.user.id, parts[1]);
      if (!entry)
        throw new HttpError(404, "entry_not_found", "Entry not found.");
      await env.DB.prepare(
        "UPDATE entries SET last_viewed_at = ?, view_count = view_count + 1 WHERE id = ? AND user_id = ?",
      )
        .bind(nowIso(), parts[1], current.user.id)
        .run();
      entry = await loadEntry(env, current.user.id, parts[1]);
      return json({ entry });
    }
    requireMutationSecurity(env, request, current);
    if (request.method === "POST" && parts.length === 1) {
      const body = await requestJson(request);
      const key = request.headers.get("idempotency-key");
      if (key) {
        const previous = await env.DB.prepare(
          "SELECT response_json FROM idempotency_keys WHERE user_id = ? AND key = ?",
        )
          .bind(current.user.id, key)
          .first<{ response_json: string }>();
        if (previous) return json(JSON.parse(previous.response_json));
      }
      const response = { entry: await createEntry(env, current.user.id, body) };
      if (key)
        await env.DB.prepare(
          "INSERT OR REPLACE INTO idempotency_keys(user_id, key, response_json, created_at) VALUES (?, ?, ?, ?)",
        )
          .bind(
            current.user.id,
            key.slice(0, 100),
            JSON.stringify(response),
            nowIso(),
          )
          .run();
      return json(response, { status: 201 });
    }
    if (request.method === "PATCH" && parts[1])
      return json({
        entry: await updateEntry(
          env,
          current,
          parts[1],
          await requestJson(request),
        ),
      });
    if (
      request.method === "DELETE" &&
      parts[1] &&
      new URL(request.url).searchParams.get("permanent") === "true"
    ) {
      await deleteEntryPermanently(
        env,
        current,
        parts[1],
        Number(new URL(request.url).searchParams.get("version")),
      );
      return new Response(null, { status: 204 });
    }
    if (request.method === "DELETE" && parts[1])
      return json({
        entry: await updateEntry(env, current, parts[1], {
          version: Number(new URL(request.url).searchParams.get("version")),
          status: "trashed",
        }),
      });
  }
  if (parts[0] === "search" && request.method === "GET")
    return json({ entries: await listEntries(env, current.user.id, request) });
  if (parts[0] === "tags") return handleTags(env, current, request, parts);
  if (parts[0] === "saved-searches")
    return handleSavedSearches(env, current, request, parts);
  if (parts[0] === "templates")
    return handleTemplates(env, current, request, parts);
  if (parts[0] === "preferences")
    return handlePreferences(env, current, request);
  if (parts[0] === "ai") return handleAi(env, current, request);
  if (parts[0] === "sms" && parts[1] === "status" && request.method === "GET")
    return json({
      configured: Boolean(
        env.TWILIO_AUTH_TOKEN && env.SMS_ALLOWED_FROM && env.SMS_PHONE_NUMBER,
      ),
      phoneNumber: env.SMS_PHONE_NUMBER || "",
      webhookUrl: `${env.APP_ORIGIN}/api/v1/sms/inbound`,
      keywords: ["NOTE", "IDEA", "LIST", "REMIND", "HELP"],
    });
  if (parts[0] === "push-subscriptions") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, device_label, created_at, last_success_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC",
      )
        .bind(current.user.id)
        .all();
      return json({ subscriptions: rows.results });
    }
    requireMutationSecurity(env, request, current);
    if (request.method === "POST") {
      const body = await requestJson(request);
      const subscription = body.subscription as
        Record<string, unknown> | undefined;
      const keys = subscription?.keys as Record<string, unknown> | undefined;
      const endpoint = normalizeWhitespace(subscription?.endpoint, 2_000);
      if (!endpoint || !keys?.p256dh || !keys.auth)
        throw new HttpError(
          400,
          "subscription_invalid",
          "Push subscription is invalid.",
        );
      let endpointUrl: URL;
      try {
        endpointUrl = new URL(endpoint);
      } catch {
        throw new HttpError(
          400,
          "subscription_invalid",
          "Push subscription is invalid.",
        );
      }
      if (endpointUrl.protocol !== "https:")
        throw new HttpError(
          400,
          "subscription_invalid",
          "Push subscriptions must use HTTPS.",
        );
      const id = crypto.randomUUID();
      const encrypted = await encryptString(
        env.PUSH_ENCRYPTION_KEY,
        JSON.stringify({
          endpoint,
          keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
        }),
      );
      await env.DB.prepare(
        `INSERT INTO push_subscriptions(id, user_id, endpoint_hash, subscription_ciphertext, device_label, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_ciphertext = excluded.subscription_ciphertext, device_label = excluded.device_label`,
      )
        .bind(
          id,
          current.user.id,
          await sha256(endpoint),
          encrypted,
          normalizeWhitespace(body.deviceLabel, 80) || "Browser",
          nowIso(),
        )
        .run();
      return json({ ok: true, id }, { status: 201 });
    }
    if (request.method === "DELETE" && parts[1]) {
      await env.DB.prepare(
        "DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?",
      )
        .bind(parts[1], current.user.id)
        .run();
      return new Response(null, { status: 204 });
    }
  }
  if (parts[0] === "clip-tokens")
    return handleClipTokens(env, current, request, parts);
  if (
    parts[0] === "import" &&
    parts[1] === "mindchuk" &&
    request.method === "POST"
  )
    return handleImport(env, current, request);
  if (parts[0] === "exports" && request.method === "GET" && parts[1])
    return handleExport(env, current, parts[1]);
  throw new HttpError(404, "route_not_found", "API route not found.");
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const requestId = crypto.randomUUID();
  try {
    const response = await handleRequest(context.env, context.request);
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    return addCors(
      context.env,
      context.request,
      errorResponse(error, requestId),
    );
  }
};
