export interface SharedCapture {
  id: string;
  title: string;
  text: string;
  url: string;
  files: File[];
  createdAt: string;
}

const DB_NAME = "mindboss-offline";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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

export async function takePendingShare(): Promise<SharedCapture | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("shares", "readwrite");
    const store = transaction.objectStore("shares");
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const result = cursor.result;
      if (!result) {
        resolve(null);
        return;
      }
      const value = result.value as SharedCapture;
      result.delete();
      resolve(value);
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

export async function saveOutbox(payload: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db
      .transaction("outbox", "readwrite")
      .objectStore("outbox")
      .put(payload);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function drainOutbox(): Promise<Array<Record<string, unknown>>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("outbox", "readwrite");
    const store = transaction.objectStore("outbox");
    const request = store.getAll();
    request.onsuccess = () => {
      const values = request.result as Array<Record<string, unknown>>;
      store.clear();
      resolve(values);
    };
    request.onerror = () => reject(request.error);
  });
}

export function saveDraft(value: unknown): void {
  localStorage.setItem("mindboss.composer.draft", JSON.stringify(value));
}

export function loadDraft<T>(): T | null {
  try {
    return JSON.parse(
      localStorage.getItem("mindboss.composer.draft") || "null",
    ) as T | null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem("mindboss.composer.draft");
}
