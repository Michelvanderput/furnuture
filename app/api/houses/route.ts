import { NextResponse } from "next/server";
import { batches, slugify, type HouseFields, type Row, type Table } from "@/lib/db/rows";
import { applyChanges, createHouse, dbConfigured, DbError, findHouse } from "@/lib/db/supabase";

export const runtime = "nodejs";

const fail = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });

/**
 * GET                 -> { configured }
 * GET ?name=<naam>    -> { configured, house: { id, slug, name, title } | null }
 */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (!dbConfigured()) return NextResponse.json({ configured: false, house: null });
  if (!name) return NextResponse.json({ configured: true });
  try {
    const slug = slugify(name);
    if (!slug) return NextResponse.json({ error: "Vul een naam in" }, { status: 400 });
    return NextResponse.json({ configured: true, house: await findHouse(slug) });
  } catch (e) {
    return fail(e);
  }
}

/** POST { name, house, rows } -> { id, slug, updatedAt }: a new house with everything in it. */
export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > 4_000_000) throw new DbError("Te veel in één keer", 413);
    const { name, house, rows } = JSON.parse(text) as { name?: string; house?: HouseFields; rows?: Partial<Record<Table, Row[]>> };
    const slug = slugify(name ?? "");
    if (!slug) throw new DbError("Vul een naam in", 400);
    const created = await createHouse(slug, { ...house, name: name!.trim() });
    let updatedAt = created.updated_at;
    const upserts = Object.entries(rows ?? {}).map(([table, list]) => ({ table: table as Table, rows: list ?? [] }));
    for (const b of batches({ upserts, deletes: [] })) updatedAt = await applyChanges(created.id, b);
    return NextResponse.json({ id: created.id, slug, updatedAt });
  } catch (e) {
    return fail(e);
  }
}
