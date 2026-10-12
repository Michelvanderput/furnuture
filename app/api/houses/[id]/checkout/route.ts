import { NextResponse } from "next/server";
import { verifyOtp } from "@/lib/auth.server";
import { DbError, isUuid } from "@/lib/db/supabase";
import { createCheckoutSession } from "@/lib/stripe.server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST { email, code }: verifies the emailed code first (real authentication before
 * money changes hands, see the audit's checklist), then starts a Stripe Checkout
 * session for this house's one-time Premium upgrade. Returns { url } to redirect to.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new DbError("Onbekende woning", 404);
    const { email, code } = (await req.json()) as { email?: string; code?: string };
    const confirmed = await verifyOtp(String(email ?? "").trim().toLowerCase(), String(code ?? "").trim());
    const url = await createCheckoutSession(req, id, confirmed);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: e instanceof DbError ? e.status : 500 });
  }
}
