import { NextResponse } from "next/server";
import { DbError, isUuid, membersOf } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET -> { members: ["Michel", "Sanne"] }: who a question can be sent to. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    return NextResponse.json({ members: await membersOf(id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
  }
}
