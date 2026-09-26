import type { Project, Scene } from "./types";

/**
 * The project lives in IndexedDB (not localStorage) because uploaded photos are
 * stored as data URLs and quickly exceed localStorage's ~5 MB limit.
 *
 * It is stored in parts (listing, products, plans, one record per photo's
 * design) and only the parts that changed are written. Updates are immutable,
 * so "changed" is a cheap reference check. Moving a sofa rewrites only that
 * photo's design instead of copying the whole project, uploaded photos included,
 * every half second.
 *
 * A second store, "cache", keeps AI results (see aiCache.ts).
 */
const DB = "furnuture";
const STORE = "kv";
export const CACHE_STORE = "cache";
const LEGACY_KEY = "project";
const VERSION_KEY = "format";
const FORMAT = 2;

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

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** What was last written, per part: the next save compares against this. */
type Parts = { listing: unknown; products: unknown; plans: unknown; scenes: Record<string, Scene> };
let saved: Parts | null = null;

const sceneKey = (id: string) => `scene:${id}`;

/** The saved project; `legacy` when it is still in the old single-record format. */
export async function loadProject(): Promise<{ project: Project; legacy: boolean } | null> {
  try {
    const d = await openDb();
    const store = d.transaction(STORE).objectStore(STORE);
    const [format, keys] = await Promise.all([req(store.get(VERSION_KEY)), req(store.getAllKeys())]);
    if (format !== FORMAT) {
      const legacy = (await req(d.transaction(STORE).objectStore(STORE).get(LEGACY_KEY))) as Project | undefined;
      return legacy ? { project: legacy, legacy: true } : null; // written in parts on the first save
    }
    const s = d.transaction(STORE).objectStore(STORE);
    const sceneKeys = (keys as string[]).filter((k) => typeof k === "string" && k.startsWith("scene:"));
    const [listing, products, plans, ...scenes] = await Promise.all([
      req(s.get("listing")),
      req(s.get("products")),
      req(s.get("plans")),
      ...sceneKeys.map((k) => req(s.get(k))),
    ]);
    const project: Project = {
      listing: (listing as Project["listing"]) ?? null,
      products: (products as Project["products"]) ?? [],
      plans: plans as Project["plans"],
      scenes: Object.fromEntries((scenes as Scene[]).filter(Boolean).map((sc) => [sc.photoId, sc])),
    };
    return { project, legacy: false };
  } catch {
    return null;
  }
}

/** Marks a loaded project as saved, so the first save after loading writes nothing. */
export function markSaved(project: Project): void {
  saved = { listing: project.listing, products: project.products, plans: project.plans, scenes: { ...project.scenes } };
}

export async function saveProject(project: Project): Promise<void> {
  const prev = saved;
  const next: Parts = { listing: project.listing, products: project.products, plans: project.plans, scenes: { ...project.scenes } };
  const writes: [string, unknown][] = [];
  const deletes: string[] = [];
  if (!prev || prev.listing !== next.listing) writes.push(["listing", next.listing]);
  if (!prev || prev.products !== next.products) writes.push(["products", next.products]);
  if (!prev || prev.plans !== next.plans) writes.push(["plans", next.plans]);
  for (const [id, scene] of Object.entries(next.scenes)) if (!prev || prev.scenes[id] !== scene) writes.push([sceneKey(id), scene]);
  if (prev) for (const id of Object.keys(prev.scenes)) if (!(id in next.scenes)) deletes.push(sceneKey(id));
  if (!writes.length && !deletes.length) return;
  saved = next;
  try {
    const d = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (!prev) {
        // First save of this session: a full write, which also moves old single-record data over.
        store.clear();
        store.put(FORMAT, VERSION_KEY);
      }
      for (const [k, v] of writes) store.put(v, k);
      for (const k of deletes) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Private mode, blocked storage or disk full: write everything again next time.
    saved = null;
  }
}
