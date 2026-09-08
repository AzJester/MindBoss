import type { Session } from "../shared/types";
export interface SharedCapture {
  id: string;
  title: string;
  text: string;
  url: string;
  files: File[];
  createdAt: string;
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mindboss-offline", 2);
    request.onupgradeneeded = () => {
      for (const name of ["shares", "outbox", "state"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read<T>(store: string, key?: string): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = key
      ? tx.objectStore(store).get(key)
      : tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
async function write(
  store: string,
  value: unknown,
  remove = false,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    if (remove) tx.objectStore(store).delete(String(value));
    else tx.objectStore(store).put(value);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error || new Error("Local storage could not save this capture."),
      );
    };
  });
}
export async function takePendingShare(): Promise<SharedCapture | null> {
  return (await read<SharedCapture[]>("shares"))[0] || null;
}
export async function acknowledgeShare(id: string): Promise<void> {
  await write("shares", id, true);
}
export async function saveOutbox(payload: unknown): Promise<void> {
  await write("outbox", payload);
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const sync =
      registration && "sync" in registration
        ? (
            registration as ServiceWorkerRegistration & {
              sync: { register(tag: string): Promise<void> };
            }
          ).sync
        : null;
    void sync?.register("mindboss-outbox").catch(() => undefined);
  }
}
export async function drainOutbox(): Promise<Array<Record<string, unknown>>> {
  return read("outbox");
}
export async function acknowledgeOutbox(id: string): Promise<void> {
  await write("outbox", id, true);
  await acknowledgeShare(id);
}
export async function outboxCount(): Promise<number> {
  return (await drainOutbox()).length;
}
export async function withSyncLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks
    ? navigator.locks.request("mindboss-sync", action)
    : action();
}
export async function saveDraft(value: unknown): Promise<void> {
  await write("state", { id: "draft", value });
}
export async function loadDraft<T>(): Promise<T | null> {
  const stored = await read<{ value: T } | undefined>("state", "draft");
  if (stored) return stored.value;
  try {
    return JSON.parse(
      localStorage.getItem("mindboss.composer.draft") || "null",
    ) as T | null;
  } catch {
    return null;
  }
}
export async function clearDraft(): Promise<void> {
  await write("state", "draft", true);
  localStorage.removeItem("mindboss.composer.draft");
}
export async function cacheValue<T>(id: string, value: T): Promise<void> {
  await write("state", { id, value });
}
export async function cachedValue<T>(id: string): Promise<T | undefined> {
  return (await read<{ value: T } | undefined>("state", id))?.value;
}
export async function cacheIdentity(session: Session): Promise<void> {
  await cacheValue("session", {
    authenticated: session.authenticated,
    user: session.user,
  });
}
