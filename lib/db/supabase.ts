import { COLUMNS, HOUSE_COLUMNS, TABLES, type Changes, type HouseFields, type Row, type Table } from "./rows";

/**
 * The database (Supabase), used only on the server: through its REST API with the
 * service role key, which never reaches the browser. Set in Vercel by the Supabase
 * integration: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SECRET_KEY).
 */

export class DbError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

function config(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  return url && key ? { url, key } : null;
}
export const dbConfigured = () => !!config();

async function rest(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
  const c = config();
  if (!c) throw new DbError("Geen database ingesteld", 503);
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      // The older service_role key is a JWT and goes in both headers; the newer secret key (sb_secret_…) only as apikey.
      ...(c.key.startsWith("eyJ") ? { Authorization: `Bearer ${c.key}` } : {}),
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    // 42P01 / PGRST205: the tables are not there yet (the migration has not run).
    if (body.code === "42P01" || body.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(body.message ?? "")) {
      throw new DbError("De databasetabellen bestaan nog niet: voer de migratie in supabase/migrations uit.", 503);
    }
    throw new DbError(body.message ?? `Database: ${res.status}`, res.status >= 500 ? 502 : res.status);
  }
  return res;
}

const q = encodeURIComponent;
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface HouseInfo {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  updated_at: string;
}

export async function findHouse(slug: string): Promise<HouseInfo | null> {
  const res = await rest(`houses?slug=eq.${q(slug)}&select=id,slug,name,title,updated_at`);
  const [house] = (await res.json()) as HouseInfo[];
  return house ?? null;
}

/** Columns with a default: an empty value there means "the default" (they may not be null). */
const DEFAULTED: Partial<Record<Table, string[]>> = {
  photos: ["room_type", "position"],
  rooms: ["position"],
  items: ["category", "status", "qty", "must", "position", "data"],
  tasks: ["room_ids", "who", "status", "before_move", "position", "data"],
  quotes: ["added_at"],
};

/** Only known columns, with sane types (the database checks the rest). */
function clean(table: Table, rows: Row[]): Row[] {
  const defaulted = new Set(DEFAULTED[table]);
  return rows.map((r) => {
    if (typeof r.id !== "string" || !r.id || r.id.length > 80) throw new DbError("Ongeldige rij", 400);
    return Object.fromEntries(COLUMNS[table].filter((c) => r[c] != null || !defaulted.has(c)).map((c) => [c, r[c] ?? null])) as Row;
  });
}
function cleanHouse(h: HouseFields): Record<string, unknown> {
  return Object.fromEntries(HOUSE_COLUMNS.filter((c) => c in h).map((c) => [c, h[c] ?? null]));
}

export async function createHouse(slug: string, house: HouseFields): Promise<HouseInfo> {
  if (await findHouse(slug)) throw new DbError("Er is al een woning met deze naam", 409);
  const res = await rest("houses?select=id,slug,name,title,updated_at", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({ ...cleanHouse(house), slug }),
  });
  const [created] = (await res.json()) as HouseInfo[];
  return created;
}

export async function loadHouse(id: string): Promise<{ house: Record<string, unknown>; rows: Record<Table, Row[]> }> {
  const res = await rest(`houses?id=eq.${q(id)}&select=*`);
  const [house] = (await res.json()) as Record<string, unknown>[];
  if (!house) throw new DbError("Woning niet gevonden", 404);
  const lists = await Promise.all(TABLES.map((t) => rest(`${t}?house_id=eq.${q(id)}&select=${COLUMNS[t].join(",")}`).then((r) => r.json() as Promise<Row[]>)));
  return { house, rows: Object.fromEntries(TABLES.map((t, i) => [t, lists[i]])) as Record<Table, Row[]> };
}

export async function houseVersion(id: string): Promise<string> {
  const res = await rest(`houses?id=eq.${q(id)}&select=updated_at`);
  const [h] = (await res.json()) as { updated_at: string }[];
  if (!h) throw new DbError("Woning niet gevonden", 404);
  return h.updated_at;
}

/** Writes what changed (upserts first, then deletes) and returns the house's new version. */
export async function applyChanges(id: string, changes: Changes): Promise<string> {
  for (const { table, rows } of changes.upserts ?? []) {
    if (!TABLES.includes(table)) throw new DbError("Onbekende tabel", 400);
    if (!rows.length) continue;
    const body = clean(table, rows).map((r) => ({ ...r, house_id: id }));
    await rest(`${table}?on_conflict=house_id,id&columns=house_id,${COLUMNS[table].join(",")}`, {
      method: "POST",
      // Keys missing from a row (see clean) get the column's default.
      prefer: "resolution=merge-duplicates,missing=default,return=minimal",
      body: JSON.stringify(body),
    });
  }
  for (const { table, ids } of changes.deletes ?? []) {
    if (!TABLES.includes(table)) throw new DbError("Onbekende tabel", 400);
    for (let i = 0; i < ids.length; i += 100) {
      const list = ids.slice(i, i + 100).map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",");
      await rest(`${table}?house_id=eq.${q(id)}&id=in.(${q(list)})`, { method: "DELETE", prefer: "return=minimal" });
    }
  }
  const res = await rest(`houses?id=eq.${q(id)}&select=updated_at`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ ...(changes.house ? cleanHouse(changes.house) : {}), updated_at: new Date().toISOString() }),
  });
  const [h] = (await res.json()) as { updated_at: string }[];
  if (!h) throw new DbError("Woning niet gevonden", 404);
  return h.updated_at;
}

// ---------------------------------------------------------------------------
// Notifications (see supabase/migrations/…_notifications.sql)

export interface PushPrefs {
  /** Someone asks you to look at something. */
  ask: boolean;
  /** Someone ordered, chose or finished something, or the planning changed. */
  updates: boolean;
  /** The morning reminder: what to order, what arrives, which job starts. */
  daily: boolean;
}
export const DEFAULT_PREFS: PushPrefs = { ask: true, updates: true, daily: true };

export interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  member: string | null;
  prefs: Partial<PushPrefs> | null;
  /** IANA time zone of the device, e.g. "Europe/Amsterdam". */
  tz?: string;
  /** "08:00": when the planning of the day arrives, local time. */
  daily_time?: string;
  /** The local day ("2026-10-01") it was last sent. */
  last_daily?: string | null;
}

export async function saveSubscription(houseId: string, s: Subscription & { user_agent?: string }): Promise<void> {
  await rest("push_subscriptions?on_conflict=house_id,id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ ...s, house_id: houseId, updated_at: new Date().toISOString() }),
  });
}

export async function removeSubscription(houseId: string, id: string): Promise<void> {
  await rest(`push_subscriptions?house_id=eq.${q(houseId)}&id=eq.${q(id)}`, { method: "DELETE", prefer: "return=minimal" });
}

/** A subscription the push service no longer knows (the app was removed, or notifications turned off). */
export async function removeEndpoint(houseId: string, endpoint: string): Promise<void> {
  await rest(`push_subscriptions?house_id=eq.${q(houseId)}&endpoint=eq.${q(endpoint)}`, { method: "DELETE", prefer: "return=minimal" });
}

const SUB_COLUMNS = "id,endpoint,p256dh,auth,member,prefs,tz,daily_time,last_daily";

export async function subscriptionsOf(houseId: string): Promise<Subscription[]> {
  const res = await rest(`push_subscriptions?house_id=eq.${q(houseId)}&select=${SUB_COLUMNS}`);
  return (await res.json()) as Subscription[];
}

/** Every device that wants notifications, with its house (for the cron). */
export async function allSubscriptions(): Promise<(Subscription & { house_id: string })[]> {
  const res = await rest(`push_subscriptions?select=house_id,${SUB_COLUMNS}`);
  return (await res.json()) as (Subscription & { house_id: string })[];
}

export async function markDailySent(houseId: string, id: string, day: string): Promise<void> {
  await rest(`push_subscriptions?house_id=eq.${q(houseId)}&id=eq.${q(id)}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ last_daily: day }) });
}

export async function countSubscriptions(houseId: string): Promise<number> {
  const res = await rest(`push_subscriptions?house_id=eq.${q(houseId)}&select=id`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
}

export async function logCronRun(report: unknown): Promise<void> {
  await rest("cron_runs", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ report }) });
  // A week is plenty to see whether the clock ticks.
  await rest(`cron_runs?ran_at=lt.${q(new Date(Date.now() - 7 * 86_400_000).toISOString())}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => undefined);
}

export async function lastCronRun(): Promise<{ ran_at: string; report: unknown } | null> {
  const res = await rest("cron_runs?select=ran_at,report&order=ran_at.desc&limit=1");
  return ((await res.json()) as { ran_at: string; report: unknown }[])[0] ?? null;
}

export interface NotificationRow {
  id?: string;
  kind: string;
  title: string;
  body: string;
  url?: string | null;
  member?: string | null;
  device?: string | null;
  key?: string | null;
  /** Only for these members (names); none = everyone. */
  recipients?: string[] | null;
  created_at?: string;
}

/** Keeps a notification; false when one with the same key was already sent. */
export async function logNotification(houseId: string, n: NotificationRow): Promise<boolean> {
  const { recipients, ...rest_ } = n;
  const row = recipients?.length ? { ...n, house_id: houseId } : { ...rest_, house_id: houseId };
  try {
    await rest("notifications", { method: "POST", prefer: "return=minimal", body: JSON.stringify(row) });
    return true;
  } catch (e) {
    if (e instanceof DbError && e.status === 409) return false;
    // The recipients column is newer (migration …_recipients.sql): without it, keep it for everyone.
    if (e instanceof DbError && e.status === 400 && recipients?.length) return logNotification(houseId, rest_);
    throw e;
  }
}

export async function recentNotifications(houseId: string, limit = 30): Promise<NotificationRow[]> {
  const query = (cols: string) => rest(`notifications?house_id=eq.${q(houseId)}&kind=neq.test&select=${cols}&order=created_at.desc&limit=${limit}`);
  const res = await query("id,kind,title,body,url,member,recipients,created_at").catch((e) => {
    // Without the newer recipients column (migration …_recipients.sql): everything is for everyone.
    if (e instanceof DbError && e.status === 400) return query("id,kind,title,body,url,member,created_at");
    throw e;
  });
  return (await res.json()) as NotificationRow[];
}

/** Who uses this house: names of devices with notifications, and of people who sent something. */
export async function membersOf(houseId: string): Promise<string[]> {
  const [subs, sent] = await Promise.all([
    subscriptionsOf(houseId),
    rest(`notifications?house_id=eq.${q(houseId)}&member=not.is.null&select=member&order=created_at.desc&limit=200`).then((r) => r.json() as Promise<{ member: string }[]>),
  ]);
  const names = [...subs.map((s) => s.member), ...sent.map((n) => n.member)].filter((m): m is string => !!m && !!m.trim());
  // One entry per name, however it is capitalised.
  const byKey = new Map<string, string>();
  for (const n of names) if (!byKey.has(n.trim().toLowerCase())) byKey.set(n.trim().toLowerCase(), n.trim());
  return [...byKey.values()];
}

export async function countSince(houseId: string, kind: string, since: Date): Promise<number> {
  const res = await rest(`notifications?house_id=eq.${q(houseId)}&kind=eq.${q(kind)}&created_at=gte.${q(since.toISOString())}&select=id`, {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
}

/** Some columns of rows as they are now (before a save changes them). */
export async function currentRows(houseId: string, table: Table, ids: string[], columns: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",");
    const res = await rest(`${table}?house_id=eq.${q(houseId)}&id=in.(${q(list)})&select=${["id", ...columns].join(",")}`);
    out.push(...((await res.json()) as Row[]));
  }
  return out;
}

export async function houseRow(id: string, columns: string[]): Promise<Record<string, unknown> | null> {
  const res = await rest(`houses?id=eq.${q(id)}&select=${columns.join(",")}`);
  return ((await res.json()) as Record<string, unknown>[])[0] ?? null;
}
