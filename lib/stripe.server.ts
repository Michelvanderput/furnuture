import Stripe from "stripe";
import { DbError } from "./db/supabase";

/**
 * Stripe, used only on the server (secret key never reaches the browser). Set in
 * Vercel: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and optionally PREMIUM_PRICE_EUR
 * (whole euros, default 49) and PREMIUM_PRICE_ID (a pre-made Stripe Price instead).
 */

let stripe: Stripe | null | undefined;
function client(): Stripe | null {
  if (stripe !== undefined) return stripe;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return (stripe = key ? new Stripe(key) : null);
}
export const stripeConfigured = () => !!client();

function origin(req: Request): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(req.url).origin;
}

/**
 * One-time Premium purchase for a house (no recurring billing in v1, see the
 * launch-plan doc). `email` has already been verified by the OTP step
 * (lib/auth.server.ts) before this is called, so Stripe collects payment for an
 * identity we already checked rather than for whatever a caller types in.
 */
export async function createCheckoutSession(req: Request, houseId: string, email: string): Promise<string> {
  const s = client();
  if (!s) throw new DbError("Betalen is nog niet ingesteld (Stripe-sleutel ontbreekt).", 503);
  const priceId = process.env.PREMIUM_PRICE_ID?.trim();
  const eur = Math.round(Number(process.env.PREMIUM_PRICE_EUR) || 49);
  const site = origin(req);
  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    client_reference_id: houseId,
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: eur * 100,
              product_data: { name: "furnuture Premium", description: "Eenmalige upgrade: automatische planning, meldingen, meerdere woningen en agenda-koppeling." },
            },
          },
    ],
    metadata: { houseId, email },
    success_url: `${site}/premium?success=1`,
    cancel_url: `${site}/premium?cancelled=1`,
  });
  if (!session.url) throw new DbError("Kon geen betaalpagina starten", 502);
  return session.url;
}

export function verifyWebhookSignature(body: string, signature: string | null): Stripe.Event {
  const s = client();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!s || !secret) throw new DbError("Webhook niet ingesteld", 503);
  if (!signature) throw new DbError("Ontbrekende handtekening", 400);
  try {
    return s.webhooks.constructEvent(body, signature, secret);
  } catch (e) {
    throw new DbError(`Ongeldige handtekening: ${e instanceof Error ? e.message : e}`, 400);
  }
}
