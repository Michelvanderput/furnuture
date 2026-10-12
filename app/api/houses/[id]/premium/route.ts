import { NextResponse } from "next/server";
import { DbError, isPremium, isUuid } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET: whether this house has Premium (used by the UI to show the upsell instead of trying a gated action and failing). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    return NextResponse.json({ premium: await isPremium(id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
  }
}
