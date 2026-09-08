const CACHE = "mindboss-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
const DB_NAME = "mindboss-offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
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
              .filter((key) => key !== CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
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
  const files = form
    .getAll("files")
    .filter((item) => item instanceof File && item.size <= 20 * 1024 * 1024)
    .slice(0, 5);
  const value = {
    id: crypto.randomUUID(),
    title: String(form.get("title") || ""),
    text: String(form.get("text") || ""),
    url: String(form.get("url") || ""),
    files,
    createdAt: new Date().toISOString(),
  };
  await new Promise((resolve, reject) => {
    const request = db
      .transaction("shares", "readwrite")
      .objectStore("shares")
      .put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
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
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/"))
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
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
