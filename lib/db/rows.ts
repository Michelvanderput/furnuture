import { migrate } from "../migrate";
import type { Item, Photo, Project, Quote, Room, Task } from "../types";

/**
 * The project as rows of the database tables (see supabase/migrations): what the app
 * keeps in one object is stored as a house with its photos, rooms, items, jobs and
 * quotes. Shared by the browser (to send only what changed) and the server.
 */

export const TABLES = ["photos", "rooms", "items", "tasks", "quotes"] as const;
export type Table = (typeof TABLES)[number];
export type Row = Record<string, unknown> & { id: string };

/** Columns per table (the server accepts only these). */
export const COLUMNS: Record<Table, string[]> = {
  photos: ["id", "url", "room_type", "room_id", "position"],
  rooms: ["id", "name", "type", "floor", "area", "budget", "note", "position"],
  items: ["id", "room_id", "alternative_of", "title", "url", "shop", "image", "category", "status", "qty", "price", "estimate", "must", "position", "data"],
  tasks: ["id", "title", "kind", "room_ids", "who", "status", "estimate", "start", "days", "before_move", "chosen_quote", "position", "data"],
  quotes: ["id", "task_id", "company", "amount", "note", "contact", "added_at"],
};
export const HOUSE_COLUMNS = ["name", "funda_url", "title", "facts", "description", "budget", "style", "key_date", "move_date", "reno_budget"] as const;
export type HouseFields = Partial<Record<(typeof HOUSE_COLUMNS)[number], unknown>>;

const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

/** Every column present (null when unset): the database's bulk insert needs the same keys in every row. */
function complete(table: Table, row: Record<string, unknown>): Row {
  return Object.fromEntries(COLUMNS[table].map((c) => [c, row[c] === undefined ? null : row[c]])) as Row;
}

export function toRows(p: Project, name: string): { house: HouseFields; rows: Record<Table, Row[]> } {
  const r = p.renovation;
  const house: HouseFields = {
    name,
    funda_url: n(p.listing?.url || undefined),
    title: n(p.listing?.title),
    facts: n(p.listing?.facts),
    description: n(p.listing?.description),
    budget: n(p.budget),
    style: n(p.style),
    key_date: n(r?.keyDate),
    move_date: n(r?.moveDate),
    reno_budget: n(r?.budget),
  };
  const photos = (p.listing?.photos ?? []).map((ph, position) =>
    complete("photos", { id: ph.id, url: ph.url, room_type: ph.room, room_id: ph.roomId, position }),
  );
  const rooms = p.rooms.map((room, position) => complete("rooms", { ...room, position }));
  const items = p.items.map((i, position) => {
    const { id, roomId, alternativeOf, title, url, shop, image, category, status, qty, price, estimate, must, ...data } = i;
    return complete("items", {
      id,
      room_id: roomId,
      alternative_of: alternativeOf,
      title,
      url,
      shop,
      image,
      category,
      status,
      qty,
      price,
      estimate,
      must: !!must,
      position,
      data,
    });
  });
  const tasks: Row[] = [];
  const quotes: Row[] = [];
  (r?.tasks ?? []).forEach((t, position) => {
    const { id, title, kind, roomIds, who, status, estimate, start, days, beforeMove, chosenQuote, quotes: qs, ...data } = t;
    tasks.push(
      complete("tasks", { id, title, kind, room_ids: roomIds, who, status, estimate, start, days, before_move: beforeMove, chosen_quote: chosenQuote, position, data }),
    );
    for (const q of qs) quotes.push(complete("quotes", { id: q.id, task_id: id, company: q.company, amount: q.amount, note: q.note, contact: q.contact, added_at: new Date(q.addedAt).toISOString() }));
  });
  return { house, rows: { photos, rooms, items, tasks, quotes } };
}

const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const byPosition = (a: Row, b: Row) => Number(a.position ?? 0) - Number(b.position ?? 0);

/** Rows from the database back into a project. */
export function fromRows(house: Record<string, unknown>, rows: Partial<Record<Table, Row[]>>): Project {
  const photos: Photo[] = [...(rows.photos ?? [])].sort(byPosition).map((r) => ({ id: r.id, url: String(r.url), room: (r.room_type as Photo["room"]) ?? "overig", roomId: str(r.room_id) }));
  const rooms: Room[] = [...(rows.rooms ?? [])].sort(byPosition).map((r) => ({
    id: r.id,
    name: String(r.name),
    type: r.type as Room["type"],
    floor: str(r.floor),
    area: num(r.area),
    budget: num(r.budget),
    note: str(r.note),
  }));
  const items: Item[] = [...(rows.items ?? [])].sort(byPosition).map((r) => ({
    ...(r.data as Partial<Item>),
    id: r.id,
    roomId: (r.room_id as string | null) ?? null,
    alternativeOf: str(r.alternative_of),
    title: String(r.title),
    url: str(r.url),
    shop: str(r.shop),
    image: str(r.image),
    images: ((r.data as Partial<Item>)?.images ?? []) as string[],
    category: r.category as Item["category"],
    status: r.status as Item["status"],
    qty: Number(r.qty ?? 1),
    price: num(r.price),
    estimate: num(r.estimate),
    must: !!r.must,
    note: ((r.data as Partial<Item>)?.note ?? "") as string,
    addedAt: Number((r.data as Partial<Item>)?.addedAt ?? 0),
  }));
  const quotesByTask = new Map<string, Quote[]>();
  for (const q of rows.quotes ?? []) {
    const list = quotesByTask.get(String(q.task_id)) ?? [];
    list.push({ id: q.id, company: String(q.company), amount: Number(q.amount), note: str(q.note), contact: str(q.contact), addedAt: q.added_at ? Date.parse(String(q.added_at)) : 0 });
    quotesByTask.set(String(q.task_id), list);
  }
  const tasks: Task[] = [...(rows.tasks ?? [])].sort(byPosition).map((r) => ({
    ...(r.data as Partial<Task>),
    id: r.id,
    title: String(r.title),
    kind: r.kind as Task["kind"],
    roomIds: (r.room_ids as string[] | null) ?? [],
    who: r.who === "zelf" ? "zelf" : "vakman",
    status: r.status as Task["status"],
    estimate: num(r.estimate),
    start: str(r.start)?.slice(0, 10),
    days: num(r.days),
    beforeMove: r.before_move !== false,
    chosenQuote: str(r.chosen_quote),
    quotes: (quotesByTask.get(r.id) ?? []).sort((a, b) => a.addedAt - b.addedAt),
    note: ((r.data as Partial<Task>)?.note ?? "") as string,
    addedAt: Number((r.data as Partial<Task>)?.addedAt ?? 0),
  }));
  const hasListing = !!(house.title || house.funda_url || photos.length);
  return migrate({
    listing: hasListing
      ? { url: str(house.funda_url) ?? "", title: str(house.title) ?? String(house.name ?? ""), photos, facts: house.facts ?? undefined, description: str(house.description) }
      : null,
    rooms,
    items,
    renovation: house.key_date || house.move_date || house.reno_budget != null || tasks.length ? { keyDate: str(house.key_date)?.slice(0, 10), moveDate: str(house.move_date)?.slice(0, 10), budget: num(house.reno_budget), tasks } : undefined,
    budget: num(house.budget),
    style: str(house.style),
  });
}

// ---------------------------------------------------------------------------
// What changed since the last save

/** The last saved state, per table and row id, as JSON text (cheap to compare). */
export interface Snapshot {
  house: string;
  rows: Record<Table, Map<string, string>>;
}

export function snapshot(house: HouseFields, rows: Record<Table, Row[]>): Snapshot {
  return {
    house: JSON.stringify(house),
    rows: Object.fromEntries(TABLES.map((t) => [t, new Map(rows[t].map((r) => [r.id, JSON.stringify(r)]))])) as Record<Table, Map<string, string>>,
  };
}

export interface Changes {
  house?: HouseFields;
  upserts: { table: Table; rows: Row[] }[];
  deletes: { table: Table; ids: string[] }[];
}

export function diff(prev: Snapshot | null, house: HouseFields, rows: Record<Table, Row[]>): Changes {
  const changes: Changes = { upserts: [], deletes: [] };
  if (!prev || prev.house !== JSON.stringify(house)) changes.house = house;
  for (const t of TABLES) {
    const before = prev?.rows[t] ?? new Map<string, string>();
    const up = rows[t].filter((r) => before.get(r.id) !== JSON.stringify(r));
    if (up.length) changes.upserts.push({ table: t, rows: up });
    const ids = new Set(rows[t].map((r) => r.id));
    const gone = [...before.keys()].filter((id) => !ids.has(id));
    if (gone.length) changes.deletes.push({ table: t, ids: gone });
  }
  return changes;
}

export const isEmpty = (c: Changes) => !c.house && !c.upserts.length && !c.deletes.length;

/** Splits changes into requests of at most `max` characters (a server accepts only so much at once). */
export function batches(c: Changes, max = 2_500_000): Changes[] {
  const out: Changes[] = [];
  let cur: Changes = { house: c.house, upserts: [], deletes: [...c.deletes] };
  let size = JSON.stringify(cur).length;
  for (const { table, rows } of c.upserts) {
    for (const row of rows) {
      const s = JSON.stringify(row).length + 1;
      if (size + s > max && (cur.upserts.length || cur.house || cur.deletes.length)) {
        out.push(cur);
        cur = { upserts: [], deletes: [] };
        size = 30;
      }
      const last = cur.upserts.at(-1);
      if (last?.table === table) last.rows.push(row);
      else cur.upserts.push({ table, rows: [row] });
      size += s;
    }
  }
  if (!isEmpty(cur)) out.push(cur);
  return out;
}

/** The name people type, normalised: "Karbindersdreef 49 " → "karbindersdreef-49". */
export const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
