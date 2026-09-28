"use client";

import { batches, diff, fromRows, isEmpty, slugify, snapshot, toRows, type Changes, type Row, type Snapshot, type Table } from "./db/rows";
import { senderHeaders } from "./push";
import { assignPhotos, defaultRooms, newId } from "./rooms";
import type { FundaResult, Listing, Project, RoomType } from "./types";

/**
 * Houses by name. With a database (Supabase, see supabase/migrations) a house is
 * stored online and anyone who types the same name opens the same house; without
 * one, houses are kept on this device only. Either way the device keeps a copy per
 * house (storage.ts), so the app opens instantly and works offline.
 */

export interface HouseRef {
  /** The name normalised ("karbindersdreef-49"): the same house, however it is typed. */
  key: string;
  name: string;
  /** Its id in the database; none = only on this device. */
  id?: string;
  title?: string;
  opened?: number;
}

const LIST = "furnuture:houses";
const CURRENT = "furnuture:current";
const PENDING = "furnuture:pending:";
const LEGACY_MOVED = "furnuture:legacy-moved";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode: only for this session
  }
}

export const recentHouses = (): HouseRef[] => read<HouseRef[]>(LIST, []).sort((a, b) => (b.opened ?? 0) - (a.opened ?? 0));

export function rememberHouse(ref: HouseRef): HouseRef {
  const next = { ...ref, opened: Date.now() };
  write(LIST, [next, ...recentHouses().filter((h) => h.key !== ref.key)].slice(0, 12));
  write(CURRENT, ref.key);
  return next;
}
export const forgetHouse = (key: string) => write(LIST, recentHouses().filter((h) => h.key !== key));
export const currentHouse = (): HouseRef | null => {
  const key = read<string | null>(CURRENT, null);
  return (key && recentHouses().find((h) => h.key === key)) || null;
};
export const leaveHouse = () => write(CURRENT, null);

/** Changes made on this device that the database does not have yet. */
export const pending = {
  get: (key: string) => read(PENDING + key, false),
  set: (key: string, on: boolean) => write(PENDING + key, on || null),
};
export const legacyMoved = {
  get: () => read(LEGACY_MOVED, false),
  set: () => write(LEGACY_MOVED, true),
};

// ---------------------------------------------------------------------------
// The database, through our API (the key to it stays on the server)

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new RemoteError("Geen verbinding", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new RemoteError(data.error ?? `Fout ${res.status}`, res.status);
  return data;
}

let configured: Promise<boolean> | null = null;
/** Is there a database? (Asked once; offline counts as "no" for now.) */
export function remoteConfigured(): Promise<boolean> {
  configured ??= api<{ configured: boolean }>("/api/houses").then(
    (r) => r.configured,
    () => ((configured = null), false),
  );
  return configured;
}

export interface RemoteHouse {
  id: string;
  slug: string;
  name: string;
  title: string | null;
}

export async function findRemote(name: string): Promise<RemoteHouse | null> {
  return (await api<{ house: RemoteHouse | null }>(`/api/houses?name=${encodeURIComponent(name)}`)).house;
}

/** Everything as it is saved (to compare against later). */
export function snapshotOf(p: Project, name: string): Snapshot {
  const { house, rows } = toRows(p, name);
  return snapshot(house, rows);
}

/** A new house in the database, with everything in it; returns its id and version. */
export async function createRemote(name: string, p: Project): Promise<{ id: string; updatedAt: string }> {
  const { house, rows } = toRows(p, name);
  const created = await api<{ id: string; updatedAt: string }>("/api/houses", { method: "POST", body: JSON.stringify({ name, house }) });
  const updatedAt = await saveRemote(created.id, diff(snapshot(house, { photos: [], rooms: [], items: [], tasks: [], quotes: [] }), house, rows));
  return { id: created.id, updatedAt: updatedAt ?? created.updatedAt };
}

export async function loadRemote(id: string, name: string): Promise<{ project: Project; updatedAt: string }> {
  const r = await api<{ house: Record<string, unknown>; rows: Record<Table, Row[]>; updatedAt: string }>(`/api/houses/${id}`);
  return { project: fromRows({ ...r.house, name }, r.rows), updatedAt: r.updatedAt };
}

/** Saves what changed, in requests small enough for the server; returns the new version. */
export async function saveRemote(id: string, changes: Changes): Promise<string | undefined> {
  if (isEmpty(changes)) return undefined;
  let version: string | undefined;
  for (const b of batches(changes)) version = (await api<{ updatedAt: string }>(`/api/houses/${id}`, { method: "POST", body: JSON.stringify(b), headers: senderHeaders() })).updatedAt;
  return version;
}

export const remoteVersion = async (id: string) => (await api<{ updatedAt: string }>(`/api/houses/${id}?version`)).updatedAt;

export const houseKey = slugify;

/** A share link that opens this house (the name is the key). */
export const houseLink = (ref: HouseRef) => `${location.origin}/?woning=${encodeURIComponent(ref.name)}`;

// ---------------------------------------------------------------------------

/** A house from Funda (or photos) as the project's listing, with a first set of rooms. */
export function withHouse(p: Project, url: string, data: FundaResult): Project {
  const listing: Listing = {
    url,
    title: data.title || "Ons nieuwe huis",
    photos: data.photos.map((u) => ({ id: newId(), url: u, room: (data.rooms?.[u] ?? "overig") as RoomType })),
    facts: data.facts,
    description: data.description,
  };
  const rooms = defaultRooms(listing);
  // Items of an earlier house stay on the list, without a room.
  return { ...p, listing: { ...listing, photos: assignPhotos(listing.photos, rooms) }, rooms, items: p.items.map((i) => ({ ...i, roomId: null })) };
}

/** A house sent by the bookmarklet (#import={u,t,p}), if the page was opened with one. */
export function importFromHash(extract: (html: string) => string[]): { url: string; data: FundaResult } | null {
  if (typeof location === "undefined" || !location.hash.startsWith("#import=")) return null;
  try {
    const d = JSON.parse(decodeURIComponent(location.hash.slice(8))) as { u: string; t: string; p: string[] };
    const photos = extract(d.p.join(" "));
    if (!photos.length) return null;
    const title = d.t.replace(/\s*[|\-[]\s*funda.*$/i, "").replace(/^[^:]{0,30}:\s*/, "").trim();
    return { url: d.u, data: { title, photos } };
  } catch {
    return null;
  }
}
export const clearImportHash = () => history.replaceState(null, "", location.pathname + location.search + "#/");
