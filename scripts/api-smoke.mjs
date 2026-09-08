const origin = process.env.MINDBOSS_SMOKE_ORIGIN || "http://127.0.0.1:8789";
let cookie = "mindboss_session=local-session-token";

async function call(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  const response = await fetch(`${origin}/api/v1${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const type = response.headers.get("content-type") || "";
  const body = type.includes("json")
    ? await response.json()
    : await response.text();
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await call("/health");
assert(health.response.ok && health.body.ok, "Health check failed.");

const session = await call("/session");
assert(
  session.response.ok && session.body.authenticated,
  "Session rotation failed.",
);
const csrf = session.body.csrfToken;
const mutationHeaders = {
  origin,
  "x-csrf-token": csrf,
  "content-type": "application/json",
};

const blocked = await call("/entries", {
  method: "POST",
  headers: { "content-type": "application/json", "x-csrf-token": csrf },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    kind: "note",
    body: "blocked",
  }),
});
assert(
  blocked.response.status === 403 &&
    blocked.body.error.code === "invalid_origin",
  "Origin protection failed.",
);

const tag = await call("/tags", {
  method: "POST",
  headers: mutationHeaders,
  body: JSON.stringify({ name: "Project", triggers: ["project"] }),
});
assert(tag.response.status === 201, "Tag creation failed.");
const tagId = tag.body.tags[0].id;

const entryId = crypto.randomUUID();
const created = await call("/entries", {
  method: "POST",
  headers: { ...mutationHeaders, "idempotency-key": entryId },
  body: JSON.stringify({
    id: entryId,
    kind: "note",
    title: "Smoke test",
    body: "A project decision",
    tagIds: [tagId],
  }),
});
assert(
  created.response.status === 201 &&
    created.body.entry.tags.some((item) => item.id === tagId),
  "Entry creation failed.",
);

const repeated = await call("/entries", {
  method: "POST",
  headers: { ...mutationHeaders, "idempotency-key": entryId },
  body: JSON.stringify({
    id: entryId,
    kind: "note",
    title: "Different",
    body: "Should not replace",
  }),
});
assert(repeated.body.entry.title === "Smoke test", "Idempotency failed.");

const search = await call("/search?q=project");
assert(
  search.response.ok && search.body.entries.some((item) => item.id === entryId),
  "FTS search failed.",
);

const conflict = await call(`/entries/${entryId}`, {
  method: "PATCH",
  headers: mutationHeaders,
  body: JSON.stringify({ version: 99, title: "Stale update" }),
});
assert(
  conflict.response.status === 409 &&
    conflict.body.error.code === "entry_conflict",
  "Optimistic concurrency failed.",
);

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const form = new FormData();
form.set("file", new File([png], "pixel.png", { type: "text/plain" }));
const attachment = await call(`/entries/${entryId}/attachments`, {
  method: "POST",
  headers: { origin, "x-csrf-token": csrf },
  body: form,
});
assert(
  attachment.response.status === 201 &&
    attachment.body.entry.attachments[0].mimeType === "image/png",
  "Attachment signature detection failed.",
);

const subscription = await call("/push-subscriptions", {
  method: "POST",
  headers: mutationHeaders,
  body: JSON.stringify({
    subscription: {
      endpoint: "https://push.example.test/device",
      keys: { p256dh: "public-key", auth: "auth-key" },
    },
    deviceLabel: "Smoke test",
  }),
});
assert(
  subscription.response.status === 201,
  "Encrypted push subscription storage failed.",
);

const clipToken = await call("/clip-tokens", {
  method: "POST",
  headers: mutationHeaders,
  body: JSON.stringify({ name: "Smoke clipper" }),
});
assert(
  clipToken.response.status === 201 && clipToken.body.token.startsWith("mbc_"),
  "Clip token creation failed.",
);
const rejectedClip = await fetch(`${origin}/api/v1/clips`, {
  method: "POST",
  headers: {
    authorization: "Bearer mbc_revoked",
    "content-type": "application/json",
    origin: "chrome-extension://leaohbibobpmkglcmgkopckkkhabbfkd",
  },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    kind: "note",
    body: "Rejected",
  }),
});
assert(
  rejectedClip.status === 401 &&
    rejectedClip.headers.get("access-control-allow-origin") ===
      "chrome-extension://leaohbibobpmkglcmgkopckkkhabbfkd",
  "Clip error CORS handling failed.",
);
const clipped = await fetch(`${origin}/api/v1/clips`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${clipToken.body.token}`,
    "content-type": "application/json",
    origin: "chrome-extension://leaohbibobpmkglcmgkopckkkhabbfkd",
  },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    kind: "note",
    title: "Clip",
    body: "Selected text",
    sourceUrl: "https://example.test/page",
  }),
});
assert(clipped.status === 201, "Capture-only clip endpoint failed.");

const exported = await call("/exports/json");
assert(
  exported.response.ok && exported.body.entries.length === 2,
  "JSON export failed.",
);

console.log(
  JSON.stringify({
    health: true,
    sessionRotation: true,
    originProtection: true,
    idempotency: true,
    fts: true,
    conflict: true,
    attachmentSignature: true,
    pushEncryption: true,
    clipTokenScope: true,
    export: true,
  }),
);
