import webpush from "web-push";

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
}

interface Subscription {
  id: string;
  subscription_ciphertext: string;
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

async function sendDueReminders(
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
    `SELECT id, user_id, title, body, reminder_at FROM entries
     WHERE kind = 'reminder' AND status = 'active' AND reminder_state = 'pending' AND reminder_at <= ?
     ORDER BY reminder_at LIMIT 100`,
  )
    .bind(now)
    .all<DueReminder>();
  let sent = 0;
  let expired = 0;
  for (const reminder of due.results) {
    const claim = await env.DB.prepare(
      "UPDATE entries SET reminder_state = 'sending', updated_at = ? WHERE id = ? AND reminder_state = 'pending'",
    )
      .bind(now, reminder.id)
      .run();
    if (!claim.meta.changes) continue;
    const subscriptions = await env.DB.prepare(
      "SELECT id, subscription_ciphertext FROM push_subscriptions WHERE user_id = ?",
    )
      .bind(reminder.user_id)
      .all<Subscription>();
    let delivered = false;
    for (const subscription of subscriptions.results) {
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
        }
      }
    }
    if (delivered) {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE entries SET reminder_state = 'delivered', updated_at = ?, version = version + 1 WHERE id = ? AND reminder_state = 'sending'",
        ).bind(now, reminder.id),
        env.DB.prepare(
          "INSERT INTO entry_events(id, entry_id, user_id, action, metadata_json, created_at) VALUES (?, ?, ?, 'reminder_delivered', '{}', ?)",
        ).bind(crypto.randomUUID(), reminder.id, reminder.user_id, now),
      ]);
    } else {
      await env.DB.prepare(
        "UPDATE entries SET reminder_state = 'pending', updated_at = ? WHERE id = ? AND reminder_state = 'sending'",
      )
        .bind(now, reminder.id)
        .run();
    }
  }
  return { due: due.results.length, sent, expired };
}

async function purgeExpired(env: Env): Promise<{ entries: number }> {
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
    const objects = await env.DB.prepare(
      "SELECT r2_key FROM attachments WHERE entry_id = ?",
    )
      .bind(entry.id)
      .all<{ r2_key: string }>();
    if (objects.results.length)
      await env.ATTACHMENTS.delete(objects.results.map((item) => item.r2_key));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM entries_fts WHERE entry_id = ?").bind(
        entry.id,
      ),
      env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(entry.id),
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
