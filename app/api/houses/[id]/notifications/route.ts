import { NextResponse } from "next/server";
import { DbError, isUuid, recentNotifications } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET -> { notifications }: the latest, newest first (the list behind the bell). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    return NextResponse.json({ notifications: await recentNotifications(id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
  }
}
