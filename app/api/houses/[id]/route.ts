import { NextResponse } from "next/server";
import type { Changes } from "@/lib/db/rows";
import { applyChanges, DbError, houseVersion, isUuid, loadHouse } from "@/lib/db/supabase";

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
    const changes = JSON.parse(text) as Changes;
    return NextResponse.json({ updatedAt: await applyChanges(id, { house: changes.house, upserts: changes.upserts ?? [], deletes: changes.deletes ?? [] }) });
  } catch (e) {
    return fail(e);
  }
}
