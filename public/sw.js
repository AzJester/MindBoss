const CACHE = "mindboss-shell-v7";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
const DB_NAME = "mindboss-offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const response = await fetch("/", { cache: "reload" });
        if (!response.ok) throw new Error("Shell unavailable");
        const html = await response.text();
        const assets = [
          ...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
        ].map((match) => match[1]);
        await cache.addAll([...SHELL, ...assets]);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) => key.startsWith("mindboss-shell-") && key !== CACHE,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("state"))
        db.createObjectStore("state", { keyPath: "id" });
      if (!db.objectStoreNames.contains("shares"))
        db.createObjectStore("shares", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox"))
        db.createObjectStore("outbox", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeShare(form) {
  const db = await openDb();
  // Keep the entire share. The preview lets the user remove oversized or extra files.
  const files = form
    .getAll("files")
    .filter((item) => item instanceof File && item.size > 0);
  const value = {
    id: crypto.randomUUID(),
    title: String(form.get("title") || ""),
    text: String(form.get("text") || ""),
    url: String(form.get("url") || ""),
    files,
    createdAt: new Date().toISOString(),
  };
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("shares", "readwrite");
    transaction.objectStore("shares").put(value);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Share was not saved"));
    };
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/capture/share") {
    event.respondWith(
      (async () => {
        await storeShare(await event.request.formData());
        return Response.redirect(
          new URL("/?shared=1", self.location.origin),
          303,
        );
      })(),
    );
    return;
  }
  if (
    url.origin !== self.location.origin ||
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // An unsuccessful navigation must not replace the working offline shell.
          // Install updates the HTML and referenced assets together.
          if (!response.ok) throw new Error("Navigation unavailable");
          return response;
        })
        .catch(() => caches.match("/", { ignoreVary: true })),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE)
                .then((cache) => cache.put(event.request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Mind Boss reminder", {
      body: data.body || "A reminder is due.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "mindboss-reminder",
      renotify: true,
      data: { url: data.url || "/?view=reminders" },
      actions: [{ action: "open", title: "Open Mind Boss" }],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).toString();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            await client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function performSync() {
  const sessionResponse = await fetch("/api/v1/session", {
    credentials: "same-origin",
  });
  if (!sessionResponse.ok) return;
  const session = await sessionResponse.json();
  if (!session.authenticated || !session.csrfToken) return;
  const db = await openDb();
  const queued = await new Promise((resolve, reject) => {
    const request = db
      .transaction("outbox", "readonly")
      .objectStore("outbox")
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const item of queued) {
    const stored = item.input ? item : { input: item, files: [] };
    const response = await fetch("/api/v1/entries", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": stored.input.id,
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify(stored.input),
    });
    if (!response.ok) continue;
    let result = await response.json();
    let uploaded = true;
    for (const attachment of stored.files || []) {
      const form = new FormData();
      form.append("file", attachment.file || attachment);
      if (attachment.extractedText)
        form.append("extractedText", attachment.extractedText);
      const upload = await fetch(
        `/api/v1/entries/${encodeURIComponent(result.entry.id)}/attachments`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": session.csrfToken },
          body: form,
        },
      );
      if (!upload.ok) {
        uploaded = false;
        break;
      }
      result = await upload.json();
    }
    if (!uploaded) continue;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["outbox", "shares"], "readwrite");
      transaction.objectStore("outbox").delete(item.id);
      transaction.objectStore("shares").delete(item.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Acknowledgment failed"));
    });
  }
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.postMessage({ type: "mindboss-synced" }));
}

async function syncOutbox() {
  return navigator.locks
    ? navigator.locks.request("mindboss-sync", performSync)
    : performSync();
}

self.addEventListener("sync", (event) => {
  if (event.tag === "mindboss-outbox") event.waitUntil(syncOutbox());
});
