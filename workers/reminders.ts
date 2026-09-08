import webpush from "web-push";
import { dateKey, nextRecurrence } from "../shared/time";

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  APP_ORIGIN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  PUSH_ENCRYPTION_KEY: string;
}

interface DueReminder {
  id: string;
  user_id: number;
  title: string;
  body: string;
  reminder_at: string;
  version: number;
  recurrence_anchor_day: number | null;
  recurrence_rule: "daily" | "weekdays" | "weekly" | "monthly" | null;
}

interface Subscription {
  id: string;
  subscription_ciphertext: string;
}

async function isQuietTime(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT quiet_start, quiet_end, display_timezone FROM user_preferences WHERE user_id = ?",
  )
    .bind(userId)
    .first<{
      quiet_start: string | null;
      quiet_end: string | null;
      display_timezone: string | null;
    }>();
  if (!row?.quiet_start || !row.quiet_end) return false;
  const current = new Intl.DateTimeFormat("en-US", {
    timeZone: row.display_timezone || "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  return row.quiet_start < row.quiet_end
    ? current >= row.quiet_start && current < row.quiet_end
    : current >= row.quiet_start || current < row.quiet_end;
}

function fromBase64url(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function decryptSubscription(
  secret: string,
  value: string,
): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }> {
  const [iv, encrypted] = value.split(".");
  if (!secret || !iv || !encrypted)
    throw new Error("Push subscription encryption is not configured.");
  const rawKey = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "decrypt",
  ]);
  const ivBytes = fromBase64url(iv).slice().buffer as ArrayBuffer;
  const encryptedBytes = fromBase64url(encrypted).slice().buffer as ArrayBuffer;
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    encryptedBytes,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function sendDueReminders(
  env: Env,
): Promise<{ due: number; sent: number; expired: number }> {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  const now = new Date().toISOString();
  const staleClaim = new Date(Date.now() - 5 * 60_000).toISOString();
  await env.DB.prepare(
    "UPDATE entries SET reminder_state = 'pending' WHERE reminder_state = 'sending' AND updated_at < ?",
  )
    .bind(staleClaim)
    .run();
  const due = await env.DB.prepare(
    `SELECT id, user_id, title, body, reminder_at, recurrence_rule, recurrence_anchor_day, version FROM entries
     WHERE kind = 'reminder' AND status = 'active' AND reminder_state = 'pending' AND reminder_at <= ?
     ORDER BY reminder_at LIMIT 100`,
  )
    .bind(now)
    .all<DueReminder>();
  let sent = 0;
  let expired = 0;
  for (const reminder of due.results) {
    if (await isQuietTime(env, reminder.user_id)) continue;
    const claim = await env.DB.prepare(
      "UPDATE entries SET reminder_state = 'sending', updated_at = ? WHERE id = ? AND reminder_state = 'pending' AND version = ? AND reminder_at = ?",
    )
      .bind(now, reminder.id, reminder.version, reminder.reminder_at)
      .run();
    if (!claim.meta.changes) continue;
    const subscriptions = await env.DB.prepare(
      "SELECT id, subscription_ciphertext FROM push_subscriptions WHERE user_id = ?",
    )
      .bind(reminder.user_id)
      .all<Subscription>();
    let delivered = false;
    let failed = false;
    for (const subscription of subscriptions.results) {
      const accepted = await env.DB.prepare(
        "SELECT 1 FROM push_deliveries WHERE entry_id = ? AND subscription_id = ? AND due_at = ?",
      )
        .bind(reminder.id, subscription.id, reminder.reminder_at)
        .first();
      if (accepted) {
        delivered = true;
        continue;
      }
      try {
        const subscriptionValue = await decryptSubscription(
          env.PUSH_ENCRYPTION_KEY,
          subscription.subscription_ciphertext,
        );
        await webpush.sendNotification(
          subscriptionValue,
          JSON.stringify({
            title: reminder.title || "Mind Boss reminder",
            body: reminder.body.slice(0, 180) || "A reminder is due.",
            url: `${env.APP_ORIGIN}/?entry=${encodeURIComponent(reminder.id)}`,
            tag: `mindboss-${reminder.id}`,
          }),
          { TTL: 3600, urgency: "high" },
        );
        await env.DB.prepare(
          "UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?",
        )
          .bind(now, subscription.id)
          .run();
        await env.DB.prepare(
          "INSERT OR IGNORE INTO push_deliveries(entry_id, subscription_id, due_at, accepted_at) VALUES (?, ?, ?, ?)",
        )
          .bind(reminder.id, subscription.id, reminder.reminder_at, now)
          .run();
        delivered = true;
        sent += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?")
            .bind(subscription.id)
            .run();
          expired += 1;
        } else {
          failed = true;
        }
      }
    }
    if (delivered && !failed) {
      const preferences = await env.DB.prepare(
        "SELECT display_timezone FROM user_preferences WHERE user_id = ?",
      )
        .bind(reminder.user_id)
        .first<{ display_timezone: string }>();
      const nextAt = nextRecurrence(
        reminder.reminder_at,
        reminder.recurrence_rule,
        preferences?.display_timezone || "America/Phoenix",
        new Date(now),
        reminder.recurrence_anchor_day || undefined,
      );
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE entries SET reminder_state = ?, reminder_at = COALESCE(?, reminder_at), recurrence_anchor_day = COALESCE(recurrence_anchor_day, ?), updated_at = ?, version = version + 1
           WHERE id = ? AND reminder_state = 'sending' AND version = ? AND reminder_at = ?`,
        ).bind(
          nextAt ? "pending" : "delivered",
          nextAt,
          Number(
            dateKey(
              reminder.reminder_at,
              preferences?.display_timezone || "America/Phoenix",
            ).slice(-2),
          ),
          now,
          reminder.id,
          reminder.version,
          reminder.reminder_at,
        ),
        env.DB.prepare(
          "INSERT INTO entry_events(id, entry_id, user_id, action, metadata_json, created_at) VALUES (?, ?, ?, 'reminder_delivered', ?, ?)",
        ).bind(
          crypto.randomUUID(),
          reminder.id,
          reminder.user_id,
          JSON.stringify({ recurrenceRule: reminder.recurrence_rule, nextAt }),
          now,
        ),
      ]);
    } else {
      await env.DB.prepare(
        "UPDATE entries SET reminder_state = 'pending', updated_at = ? WHERE id = ? AND reminder_state = 'sending' AND version = ? AND reminder_at = ?",
      )
        .bind(now, reminder.id, reminder.version, reminder.reminder_at)
        .run();
    }
  }
  return { due: due.results.length, sent, expired };
}

export async function purgeExpired(env: Env): Promise<{ entries: number }> {
  const now = new Date();
  const trashCutoff = new Date(
    now.getTime() - 30 * 24 * 60 * 60_000,
  ).toISOString();
  const sessionCutoff = now.toISOString();
  const entries = await env.DB.prepare(
    "SELECT id FROM entries WHERE status = 'trashed' AND deleted_at < ? LIMIT 100",
  )
    .bind(trashCutoff)
    .all<{ id: string }>();
  for (const entry of entries.results) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO attachment_cleanup(r2_key, created_at) SELECT a.r2_key, ? FROM attachments a JOIN entries e ON e.id=a.entry_id WHERE e.id=? AND e.status='trashed' AND e.deleted_at < ?",
      ).bind(sessionCutoff, entry.id, trashCutoff),
      env.DB.prepare(
        "INSERT OR IGNORE INTO deleted_entry_ids(id, user_id, deleted_at) SELECT id, user_id, ? FROM entries WHERE id=? AND status='trashed' AND deleted_at < ?",
      ).bind(sessionCutoff, entry.id, trashCutoff),
      env.DB.prepare(
        "DELETE FROM entries_fts WHERE entry_id IN (SELECT id FROM entries WHERE id=? AND status='trashed' AND deleted_at < ?)",
      ).bind(entry.id, trashCutoff),
      env.DB.prepare(
        "DELETE FROM entries WHERE id=? AND status='trashed' AND deleted_at < ?",
      ).bind(entry.id, trashCutoff),
    ]);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(
      sessionCutoff,
    ),
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(
      sessionCutoff,
    ),
    env.DB.prepare("DELETE FROM idempotency_keys WHERE created_at < ?").bind(
      new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
    ),
  ]);
  const cleanup = await env.DB.prepare(
    "SELECT r2_key FROM attachment_cleanup LIMIT 100",
  ).all<{ r2_key: string }>();
  for (const item of cleanup.results) {
    try {
      await env.ATTACHMENTS.delete(item.r2_key);
      await env.DB.prepare("DELETE FROM attachment_cleanup WHERE r2_key = ?")
        .bind(item.r2_key)
        .run();
    } catch {
      /* Keep the durable cleanup job for the next run. */
    }
  }
  return { entries: entries.results.length };
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(
      (async () => {
        const [reminders, purge] = await Promise.all([
          sendDueReminders(env),
          purgeExpired(env),
        ]);
        console.log(
          JSON.stringify({ event: "scheduled_complete", reminders, purge }),
        );
      })(),
    );
  },

  async fetch(): Promise<Response> {
    return Response.json({ ok: true, service: "mindboss-reminders" });
  },
};
