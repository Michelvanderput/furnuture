import { NextResponse } from "next/server";
import { DbError, isUuid, removeSubscription, saveSubscription, type PushPrefs } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** POST { device, member, subscription, prefs }: this device wants notifications for this house (again: updates it). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    const b = (await req.json()) as { device?: string; member?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; prefs?: Partial<PushPrefs> };
    const device = clip(b.device, 64);
    const endpoint = clip(b.subscription?.endpoint, 1000);
    if (!device || !/^https:\/\//.test(endpoint) || !b.subscription?.keys?.p256dh || !b.subscription.keys.auth) throw new DbError("Ongeldig abonnement", 400);
    const prefs = { ask: b.prefs?.ask !== false, updates: b.prefs?.updates !== false, daily: b.prefs?.daily !== false };
    await saveSubscription(id, {
      id: device,
      endpoint,
      p256dh: clip(b.subscription.keys.p256dh, 200),
      auth: clip(b.subscription.keys.auth, 100),
      member: clip(b.member, 40) || null,
      prefs,
      user_agent: clip(req.headers.get("user-agent"), 200),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE ?device=… : no more notifications on this device. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const device = new URL(req.url).searchParams.get("device") ?? "";
    if (!isUuid(id) || !device) throw new DbError("Onbekend", 400);
    await removeSubscription(id, device.slice(0, 64));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
