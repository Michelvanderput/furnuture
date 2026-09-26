import { CACHE_STORE, openDb } from "./storage";

/**
 * Lasting cache for AI results (cut-outs, erased photos, room recognition), so
 * each AI job runs once per photo or product instead of on every visit. Fewer
 * AI runs means faster reopening and far fewer chances to run out of memory.
 * Bounded: the least recently used entries go first.
 */
const MAX_ENTRIES = 300;
const MAX_BYTES = 250 * 1024 * 1024;

type Entry = { value: unknown; size: number; at: number };

/** Short, stable fingerprint of a (possibly long) string such as a data URL. FNV-1a, 2×32 bit. */
export function fingerprint(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length.toString(36);
}

const fingerprints = new Map<string, string>();
/** `fingerprint` remembered per string (image URLs are checked on every render). */
export function fingerprintOf(s: string): string {
  let fp = fingerprints.get(s);
  if (!fp) {
    fp = fingerprint(s);
    fingerprints.set(s, fp);
    if (fingerprints.size > 500) fingerprints.delete(fingerprints.keys().next().value!);
  }
  return fp;
}

const sizeOf = (v: unknown): number => {
  if (v instanceof Blob) return v.size;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v && typeof v === "object") return Object.values(v).reduce<number>((n, x) => n + sizeOf(x), 0);
  if (typeof v === "string") return v.length * 2;
  return 8;
};

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const d = await openDb();
    const entry = await new Promise<Entry | undefined>((resolve, reject) => {
      const tx = d.transaction(CACHE_STORE, "readwrite");
      const store = tx.objectStore(CACHE_STORE);
      const r = store.get(key);
      r.onsuccess = () => {
        const e = r.result as Entry | undefined;
        if (e) store.put({ ...e, at: Date.now() }, key); // recently used
        resolve(e);
      };
      r.onerror = () => reject(r.error);
    });
    return (entry?.value as T) ?? null;
  } catch {
    return null;
  }
}

let pruning: Promise<void> | null = null;

export async function putCached(key: string, value: unknown): Promise<void> {
  try {
    const d = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(CACHE_STORE, "readwrite");
      tx.objectStore(CACHE_STORE).put({ value, size: sizeOf(value), at: Date.now() } satisfies Entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    pruning ??= prune().finally(() => (pruning = null));
  } catch {
    // Storage full or blocked: the result is simply not remembered.
  }
}

/** Drops the least recently used entries beyond the limits. Reads only sizes and times (a cursor over all entries). */
async function prune(): Promise<void> {
  const d = await openDb();
  const meta: { key: IDBValidKey; size: number; at: number }[] = [];
  await new Promise<void>((resolve, reject) => {
    const r = d.transaction(CACHE_STORE).objectStore(CACHE_STORE).openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve();
      const e = c.value as Entry;
      meta.push({ key: c.key, size: e.size, at: e.at });
      c.continue();
    };
    r.onerror = () => reject(r.error);
  });
  let bytes = meta.reduce((n, m) => n + m.size, 0);
  if (meta.length <= MAX_ENTRIES && bytes <= MAX_BYTES) return;
  meta.sort((x, y) => x.at - y.at);
  const tx = d.transaction(CACHE_STORE, "readwrite");
  let count = meta.length;
  for (const m of meta) {
    if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    tx.objectStore(CACHE_STORE).delete(m.key);
    count--;
    bytes -= m.size;
  }
}
