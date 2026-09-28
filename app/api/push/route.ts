import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db/supabase";
import { publicKey } from "@/lib/push.server";

export const runtime = "nodejs";

/** GET -> { publicKey, db }: can this app send notifications (keys set, and a database to keep subscriptions)? */
export async function GET() {
  return NextResponse.json({ publicKey: dbConfigured() ? publicKey() : null, db: dbConfigured() });
}
