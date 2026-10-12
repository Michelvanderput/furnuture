import { NextResponse } from "next/server";
import { requestOtp } from "@/lib/auth.server";
import { DbError } from "@/lib/db/supabase";

export const runtime = "nodejs";

/** POST { email }: sends a 6-digit code (Supabase itself rate-limits how often one address can ask). */
export async function POST(req: Request) {
  try {
    const { email } = (await req.json()) as { email?: string };
    await requestOtp(String(email ?? "").trim().toLowerCase());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
  }
}
