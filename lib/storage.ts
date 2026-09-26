import type { Project } from "./types";

/**
 * The project lives in IndexedDB (not localStorage) because uploaded photos are
 * stored as data URLs and quickly exceed localStorage's ~5 MB limit.
 */
const DB = "furnuture";
const STORE = "kv";
const KEY = "project";

let db: Promise<IDBDatabase> | null = null;

/** One connection for the whole session (opening IndexedDB per save is slow on iPad). */
function open(): Promise<IDBDatabase> {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      req.result.onclose = () => (db = null);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  db.catch(() => (db = null));
  return db;
}

/**
 * Ask the browser to keep our data. Without this Safari may delete a site's
 * storage after 7 days without a visit (not when the app is on the home screen).
 */
export function requestPersistence(): void {
  try {
    navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // not supported
  }
}

export async function loadProject(): Promise<Project | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Project | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(project, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private mode or blocked storage: the app still works for this visit.
  }
}
