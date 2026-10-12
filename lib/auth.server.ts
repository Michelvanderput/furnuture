import { DbError } from "./db/supabase";

/**
 * Real email verification before a paid upgrade, via Supabase Auth's built-in email
 * OTP (the same Supabase project as the database — no separate account system to
 * build or maintain). The flow is stateless on our side: Supabase issues and checks
 * the 6-digit code itself, we only relay to it with the service role key (server to
 * server, never exposed to the browser).
 */

function authConfig(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  return url && key ? { url, key } : null;
}
export const authConfigured = () => !!authConfig();

async function authRest(path: string, body: unknown): Promise<Record<string, unknown>> {
  const c = authConfig();
  if (!c) throw new DbError("Inloggen is nog niet ingesteld (database ontbreekt)", 503);
  const res = await fetch(`${c.url}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: c.key,
      ...(c.key.startsWith("eyJ") ? { Authorization: `Bearer ${c.key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new DbError((data.error_description as string) || (data.msg as string) || (data.error as string) || "Inloggen mislukt", res.status === 429 ? 429 : 400);
  return data;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function validEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

/** Sends a 6-digit code to `email`. Supabase itself rate-limits how often this can be called per address. */
export async function requestOtp(email: string): Promise<void> {
  if (!validEmail(email)) throw new DbError("Ongeldig e-mailadres", 400);
  await authRest("otp", { email, create_user: true });
}

/** Verifies the code; returns the confirmed email on success (it can only be the address the code was sent to). */
export async function verifyOtp(email: string, code: string): Promise<string> {
  if (!validEmail(email)) throw new DbError("Ongeldig e-mailadres", 400);
  if (!/^\d{6}$/.test(code)) throw new DbError("Vul de 6-cijferige code in", 400);
  const data = await authRest("verify", { email, token: code, type: "email" });
  const confirmed = (data.user as { email?: string } | undefined)?.email || email;
  return confirmed;
}
