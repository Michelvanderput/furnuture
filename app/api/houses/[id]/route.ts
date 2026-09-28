import { NextResponse } from "next/server";
import type { Changes } from "@/lib/db/rows";
import { applyChanges, currentRows, DbError, houseRow, houseVersion, isUuid, loadHouse, subscriptionsOf } from "@/lib/db/supabase";
import { activity, type Before } from "@/lib/notify";
import { sendToHouse } from "@/lib/push.server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });

/**
 * GET                -> { house, rows, updatedAt }  (everything)
 * GET ?version       -> { updatedAt }                (has another device saved?)
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    if (new URL(req.url).searchParams.has("version")) return NextResponse.json({ updatedAt: await houseVersion(id) });
    const { house, rows } = await loadHouse(id);
    return NextResponse.json({ house, rows, updatedAt: house.updated_at });
  } catch (e) {
    return fail(e);
  }
}

/** POST { house?, upserts, deletes } -> { updatedAt }: saves what changed. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    const text = await req.text();
    if (text.length > 4_000_000) throw new DbError("Te veel in één keer", 413);
    const raw = JSON.parse(text) as Changes;
    const changes: Changes = { house: raw.house, upserts: raw.upserts ?? [], deletes: raw.deletes ?? [] };
    // Other devices hear about news (ordered, done, replanned…), never about their own changes.
    const device = req.headers.get("x-device")?.slice(0, 64) ?? "";
    const member = decodeURIComponent(req.headers.get("x-member") ?? "").slice(0, 40);
    const before = await snapshotForNews(id, changes, device).catch(() => null);
    const updatedAt = await applyChanges(id, changes);
    if (before) {
      const note = activity(before, changes, member);
      if (note) await sendToHouse(id, note, { kind: "updates", houseName: String(before.house?.name ?? ""), exceptDevice: device, device, member }).catch(() => undefined);
    }
    return NextResponse.json({ updatedAt });
  } catch (e) {
    return fail(e);
  }
}

/** What notifications compare against, read before the save; null when nobody else would be notified. */
async function snapshotForNews(id: string, changes: Changes, device: string): Promise<Before | null> {
  const subs = await subscriptionsOf(id);
  if (!subs.some((s) => s.id !== device && s.prefs?.updates !== false)) return null;
  const ids = (table: string) => changes.upserts.filter((u) => u.table === table).flatMap((u) => u.rows.map((r) => r.id));
  const [items, tasks, quotes, house] = await Promise.all([
    currentRows(id, "items", ids("items"), ["status", "title"]),
    currentRows(id, "tasks", ids("tasks"), ["status", "title", "start", "chosen_quote"]),
    currentRows(id, "quotes", ids("quotes"), []),
    houseRow(id, ["name", "key_date", "move_date"]),
  ]);
  return {
    items: new Map(items.map((r) => [r.id, r])),
    tasks: new Map(tasks.map((r) => [r.id, r])),
    quotes: new Set(quotes.map((r) => r.id)),
    house,
  };
}
