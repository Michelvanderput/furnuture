import { NextResponse } from "next/server";
import { markPremium, premiumSessionSeen } from "@/lib/db/supabase";
import { verifyWebhookSignature } from "@/lib/stripe.server";
import type Stripe from "stripe";

export const runtime = "nodejs";

/** Stripe webhook: on a completed Checkout session, marks the house premium. Configure this URL (…/api/stripe/webhook) in the Stripe dashboard for the `checkout.session.completed` event. */
export async function POST(req: Request) {
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(body, req.headers.get("stripe-signature"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ongeldig verzoek" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const houseId = session.client_reference_id || session.metadata?.houseId;
    const email = session.customer_details?.email || session.customer_email || session.metadata?.email;
    if (houseId && email && session.payment_status === "paid" && !(await premiumSessionSeen(session.id))) {
      await markPremium(houseId, email, session.id);
    }
  }
  return NextResponse.json({ received: true });
}
