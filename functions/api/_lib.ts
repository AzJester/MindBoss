import type { Attachment, Entry, ListItem, Tag } from "../../shared/types";
import { normalizeTagName, triggerMatches } from "../../shared/validation";

export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  APP_ORIGIN: string;
  ALLOWED_GITHUB_USER_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  PUSH_ENCRYPTION_KEY: string;
  EXTENSION_ORIGIN?: string;
  VAPID_PUBLIC_KEY?: string;
  OPENAI_API_KEY?: string;
  TWILIO_AUTH_TOKEN?: string;
  SMS_ALLOWED_FROM?: string;
  SMS_PHONE_NUMBER?: string;
}

export interface AuthContext {
  tokenHash: string;
  csrfToken: string;
  user: {
    id: number;
    login: string;
    avatarUrl: string;
    timezone: string;
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }
  console.error(JSON.stringify({ requestId, code: "internal_error" }));
  return json(
    {
      error: {
        code: "internal_error",
        message: "Mind Boss could not complete that request.",
        requestId,
      },
    },
    { status: 500 },
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const input =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
  );
}

function fromBase64url(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32)
    throw new HttpError(
      503,
      "push_encryption_not_configured",
      "Push notification encryption has not been configured.",
    );
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptString(
  secret: string,
  value: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

export async function decryptString(
  secret: string,
  value: string,
): Promise<string> {
  const [iv, encrypted] = value.split(".");
  if (!iv || !encrypted) throw new Error("Encrypted value is invalid.");
  const ivBytes = fromBase64url(iv).slice().buffer as ArrayBuffer;
  const encryptedBytes = fromBase64url(encrypted).slice().buffer as ArrayBuffer;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    await encryptionKey(secret),
    encryptedBytes,
  );
  return new TextDecoder().decode(decrypted);
}

export function parseCookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [
          decodeURIComponent(item.slice(0, index)),
          decodeURIComponent(item.slice(index + 1)),
        ];
      }),
  );
}

export function sessionCookie(
  value: string,
  maxAge = 60 * 60 * 24 * 30,
): string {
  return `mindboss_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function loadAuth(
  env: Env,
  request: Request,
): Promise<AuthContext | null> {
  const rawToken = parseCookies(request).mindboss_session;
  if (!rawToken) return null;
  const tokenHash = await sha256(`${rawToken}:${env.SESSION_SECRET}`);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.csrf_token, s.expires_at, u.id, u.login, u.avatar_url, u.timezone
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, nowIso())
    .first<Record<string, string | number>>();
  if (!row) return null;
  return {
    tokenHash,
    csrfToken: String(row.csrf_token),
    user: {
      id: Number(row.id),
      login: String(row.login),
      avatarUrl: String(row.avatar_url),
      timezone: String(row.timezone),
    },
  };
}

export function requireAuth(auth: AuthContext | null): AuthContext {
  if (!auth)
    throw new HttpError(401, "authentication_required", "Sign in to continue.");
  return auth;
}

export function requireMutationSecurity(
  env: Env,
  request: Request,
  auth: AuthContext,
): void {
  const origin = request.headers.get("origin");
  const csrf = request.headers.get("x-csrf-token");
  if (origin !== env.APP_ORIGIN)
    throw new HttpError(
      403,
      "invalid_origin",
      "This request did not come from Mind Boss.",
    );
  if (!csrf || csrf !== auth.csrfToken)
    throw new HttpError(
      403,
      "invalid_csrf",
      "Your session security token is missing or expired.",
    );
}

export function addCors(
  env: Env,
  request: Request,
  response: Response,
): Response {
  const origin = request.headers.get("origin");
  if (origin && env.EXTENSION_ORIGIN && origin === env.EXTENSION_ORIGIN) {
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", origin);
    headers.set(
      "access-control-allow-headers",
      "authorization, content-type, idempotency-key",
    );
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("vary", "origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

function mapTag(row: Record<string, unknown>, triggers: string[] = []): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    parentId: row.parent_id ? String(row.parent_id) : null,
    triggers,
    createdAt: String(row.created_at),
  };
}

export async function listTags(env: Env, userId: number): Promise<Tag[]> {
  const result = await env.DB.prepare(
    `SELECT t.*, COALESCE(GROUP_CONCAT(tt.trigger_text, char(31)), '') AS trigger_list
     FROM tags t LEFT JOIN tag_triggers tt ON tt.tag_id = t.id
     WHERE t.user_id = ? GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
  )
    .bind(userId)
    .all<Record<string, unknown>>();
  return result.results.map((row) =>
    mapTag(
      row,
      String(row.trigger_list || "")
        .split(String.fromCharCode(31))
        .filter(Boolean),
    ),
  );
}

export const ENTRY_SELECT = `SELECT e.*,
  (SELECT COALESCE(json_group_array(json_object('id',li.id,'text',li.text,'position',li.position,'completedAt',li.completed_at,'dueAt',li.due_at)), '[]')
   FROM (SELECT * FROM list_items WHERE entry_id=e.id ORDER BY position) li) AS items_json,
  (SELECT COALESCE(json_group_array(json_object('id',t.id,'name',t.name,'color',t.color,'parentId',t.parent_id,'createdAt',t.created_at,
   'triggers',json((SELECT COALESCE(json_group_array(trigger_text),'[]') FROM tag_triggers WHERE tag_id=t.id)))),'[]')
   FROM entry_tags et JOIN tags t ON t.id=et.tag_id WHERE et.entry_id=e.id) AS tags_json,
  (SELECT COALESCE(json_group_array(json_object('id',a.id,'entryId',a.entry_id,'fileName',a.file_name,'mimeType',a.mime_type,
   'size',a.size_bytes,'createdAt',a.created_at,'sha256',a.sha256,'extractedText',a.extracted_text,
   'url','/api/v1/entries/'||e.id||'/attachments/'||a.id)),'[]')
   FROM attachments a WHERE a.entry_id=e.id) AS attachments_json
  FROM entries e`;

export function mapEntry(row: Record<string, unknown>): Entry {
  return {
    id: String(row.id),
    kind: row.kind as Entry["kind"],
    title: String(row.title),
    body: String(row.body),
    source: row.source as Entry["source"],
    sourceUrl: row.source_url ? String(row.source_url) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    status: row.status as Entry["status"],
    pinnedAt: row.pinned_at ? String(row.pinned_at) : null,
    reminderAt: row.reminder_at ? String(row.reminder_at) : null,
    reminderState: row.reminder_state as Entry["reminderState"],
    recurrenceRule: row.recurrence_rule
      ? (String(row.recurrence_rule) as Entry["recurrenceRule"])
      : null,
    reviewAt: row.review_at ? String(row.review_at) : null,
    lastViewedAt: row.last_viewed_at ? String(row.last_viewed_at) : null,
    viewCount: Number(row.view_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
    listItems: JSON.parse(String(row.items_json || "[]")),
    tags: JSON.parse(String(row.tags_json || "[]")),
    attachments: JSON.parse(String(row.attachments_json || "[]")),
    recurrenceAnchorDay: row.recurrence_anchor_day
      ? Number(row.recurrence_anchor_day)
      : null,
  };
}

export async function loadEntry(
  env: Env,
  userId: number,
  entryId: string,
): Promise<Entry | null> {
  const row = await env.DB.prepare(
    ENTRY_SELECT + " WHERE e.id = ? AND e.user_id = ?",
  )
    .bind(entryId, userId)
    .first<Record<string, unknown>>();
  return row ? mapEntry(row) : null;
}

export async function syncEntrySearch(
  env: Env,
  entryId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT title, body, source_title, source_url FROM entries WHERE id = ?",
  )
    .bind(entryId)
    .first<Record<string, unknown>>();
  if (!row) {
    await env.DB.prepare("DELETE FROM entries_fts WHERE entry_id = ?")
      .bind(entryId)
      .run();
    return;
  }
  const items = await env.DB.prepare(
    "SELECT text FROM list_items WHERE entry_id = ? ORDER BY position",
  )
    .bind(entryId)
    .all<{ text: string }>();
  const attachments = await env.DB.prepare(
    "SELECT extracted_text FROM attachments WHERE entry_id = ? ORDER BY created_at",
  )
    .bind(entryId)
    .all<{ extracted_text: string }>();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entries_fts WHERE entry_id = ?").bind(entryId),
    env.DB.prepare(
      "INSERT INTO entries_fts(entry_id, title, body, source_title, source_url, list_text, attachment_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      entryId,
      String(row.title),
      String(row.body),
      String(row.source_title || ""),
      String(row.source_url || ""),
      items.results.map((item) => item.text).join("\n"),
      attachments.results.map((item) => item.extracted_text).join("\n"),
    ),
  ]);
}

export async function applyAutomaticTags(
  env: Env,
  userId: number,
  entryId: string,
  text: string,
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT t.id AS tag_id, tt.trigger_text FROM tags t
     JOIN tag_triggers tt ON tt.tag_id = t.id WHERE t.user_id = ?`,
  )
    .bind(userId)
    .all<{ tag_id: string; trigger_text: string }>();
  const matched = [
    ...new Set(
      rows.results
        .filter((row) => triggerMatches(text, row.trigger_text))
        .map((row) => row.tag_id),
    ),
  ];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "DELETE FROM entry_tags WHERE entry_id = ? AND source = 'trigger'",
    ).bind(entryId),
  ];
  for (const tagId of matched) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO entry_tags(entry_id, tag_id, source, created_at) VALUES (?, ?, 'trigger', ?)
       ON CONFLICT(entry_id, tag_id) DO NOTHING`,
      ).bind(entryId, tagId, nowIso()),
    );
  }
  await env.DB.batch(statements);
}

export async function recordEvent(
  env: Env,
  userId: number,
  entryId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO entry_events(id, entry_id, user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      entryId,
      userId,
      action,
      JSON.stringify(metadata),
      nowIso(),
    )
    .run();
}
