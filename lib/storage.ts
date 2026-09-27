import { migrate } from "./migrate";
import type { Project } from "./types";

/**
 * The project lives in IndexedDB (not localStorage): uploaded photos are data URLs
 * and quickly exceed localStorage's ~5 MB. It is stored in parts (listing, rooms,
 * items, settings) and only the parts that changed are written; updates are
 * immutable, so "changed" is a cheap reference check.
 *
 * A second store, "cache", keeps AI answers (see aiCache.ts), so the same question
 * is never paid for twice.
 */
const DB = "furnuture";
const STORE = "kv";
export const CACHE_STORE = "cache";
const VERSION_KEY = "format";
const FORMAT = 3;

let db: Promise<IDBDatabase> | null = null;

/** One connection for the whole session (opening IndexedDB per save is slow on iPad). */
export function openDb(): Promise<IDBDatabase> {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      if (!d.objectStoreNames.contains(CACHE_STORE)) d.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => {
      req.result.onclose = () => (db = null);
      // Another tab upgraded the database: let it, and reconnect on the next call.
      req.result.onversionchange = () => (req.result.close(), (db = null));
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  db.catch(() => (db = null));
  return db;
}

/** Ask the browser to keep our data (Safari may otherwise clear it after 7 days without a visit). */
export function requestPersistence(): void {
  try {
    navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // not supported
  }
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Budget and style are tiny and change together: one record, compared by value. */
type Parts = { listing: unknown; rooms: unknown; items: unknown; renovation: unknown; settings: string };
const partsOf = (p: Project): Parts => ({ listing: p.listing, rooms: p.rooms, items: p.items, renovation: p.renovation, settings: JSON.stringify({ budget: p.budget, style: p.style }) });

/** What was last written, per part: the next save compares against this. */
let saved: Parts | null = null;

/** The saved project (older formats are converted; `current` = already in this format). */
export async function loadProject(): Promise<{ project: Project; current: boolean } | null> {
  try {
    const d = await openDb();
    const s = d.transaction(STORE).objectStore(STORE);
    const format = await req(s.get(VERSION_KEY));
    const t = d.transaction(STORE).objectStore(STORE);
    if (format === FORMAT) {
      const [listing, rooms, items, renovation, settings] = await Promise.all(["listing", "rooms", "items", "renovation", "settings"].map((k) => req(t.get(k))));
      let st: { budget?: number; style?: string } = {};
      try {
        st = typeof settings === "string" ? JSON.parse(settings) : {};
      } catch {
        // keep defaults
      }
      return { project: migrate({ listing, rooms, items, renovation, budget: st.budget, style: st.style }), current: true };
    }
    if (format === 2) {
      // Version 2: listing, products, plans and one design per photo. Designs and plans are gone.
      const [listing, products] = await Promise.all([req(t.get("listing")), req(t.get("products"))]);
      return listing || products ? { project: migrate({ listing, products }), current: false } : null;
    }
    const legacy = await req(t.get("project"));
    return legacy ? { project: migrate(legacy), current: false } : null;
  } catch {
    return null;
  }
}

/** Marks a loaded project as saved, so the first save after loading writes only what changed. */
export function markSaved(project: Project): void {
  saved = partsOf(project);
}

export async function saveProject(project: Project): Promise<void> {
  const prev = saved;
  const next = partsOf(project);
  const writes = (Object.keys(next) as (keyof Parts)[]).filter((k) => !prev || prev[k] !== next[k]);
  if (!writes.length && prev) return;
  saved = next;
  try {
    const d = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (!prev) {
        // First save of this session: a full write, which also clears data of older formats.
        store.clear();
        store.put(FORMAT, VERSION_KEY);
      }
      for (const k of prev ? writes : (Object.keys(next) as (keyof Parts)[])) store.put(next[k], k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Private mode, blocked storage or disk full: write everything again next time.
    saved = null;
  }
}
