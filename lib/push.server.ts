import webpush from "web-push";
import { DEFAULT_PREFS, logNotification, removeEndpoint, subscriptionsOf, type PushPrefs, type Subscription } from "./db/supabase";
import { noteUrl, type Note } from "./notify";

/**
 * Web Push (iPhone and iPad for apps on the home screen, iOS 16.4+; Android; desktop
 * browsers). Keys in Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (mailto:…). Server only.
 */

function keys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || "mailto:furnuture@example.com" };
}
export const pushConfigured = () => !!keys();
export const publicKey = () => keys()?.publicKey ?? null;
export const vapidSubject = () => keys()?.subject ?? null;

/**
 * Only the real push services: the server posts to this address, so anything else
 * would let someone make it call any URL. PUSH_EXTRA_HOSTS (comma separated) adds
 * hosts for testing.
 */
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    const extra = (process.env.PUSH_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    return u.protocol === "https:" && (PUSH_HOSTS.test(u.hostname) || extra.includes(u.host));
  } catch {
    return false;
  }
}

export interface Payload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Sends to one device. "gone" = the push service no longer knows it (app removed, notifications off). */
export async function sendTo(houseId: string, s: Subscription, payload: Payload, urgency: "normal" | "high" = "normal"): Promise<{ ok: boolean; gone?: boolean; status?: number; error?: string }> {
  const k = keys();
  if (!k) return { ok: false, error: "VAPID-sleutels ontbreken" };
  if (!validEndpoint(s.endpoint)) return { ok: false, error: "onbekende pushdienst" };
  webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);
  try {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
      // A reminder of this morning is not useful tonight; a question from your partner is, for a day.
      TTL: payload.tag.startsWith("daily") ? 6 * 3600 : 24 * 3600,
      urgency,
    });
    return { ok: true, status: r.statusCode };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    const gone = status === 404 || status === 410;
    if (gone) await removeEndpoint(houseId, s.endpoint).catch(() => undefined);
    return { ok: false, gone, status, error: String((e as { body?: string }).body || (e as Error).message).slice(0, 300) };
  }
}

export interface SendOptions {
  kind: keyof PushPrefs | "test";
  houseName: string;
  /** Not to this device (the one that caused it). */
  exceptDevice?: string;
  /** Only to this device (a test). */
  onlyDevice?: string;
  member?: string;
  device?: string;
  /** Kept once: a second call with the same key does nothing. */
  key?: string;
  /** Keep it for the list in the app (not for tests). */
  log?: boolean;
  /** Only these members (names, any capitalisation); none = everyone. */
  to?: string[];
}

/** Keeps the notification (the list behind the bell) and sends it to the house's devices that want this kind. */
export async function sendToHouse(houseId: string, note: Note, o: SendOptions): Promise<{ sent: number; kept: boolean; results: { device: string; ok: boolean; status?: number; error?: string }[] }> {
  const url = noteUrl(o.houseName, note.open);
  const kept = o.log === false ? true : await logNotification(houseId, { kind: o.kind, title: note.title, body: note.body, url, member: o.member ?? null, device: o.device ?? null, key: o.key ?? null, recipients: o.to?.length ? o.to : null });
  if (!kept || !pushConfigured()) return { sent: 0, kept, results: [] };
  const to = new Set((o.to ?? []).map((n) => n.trim().toLowerCase()));
  const subs = (await subscriptionsOf(houseId)).filter(
    (s) =>
      (o.onlyDevice ? s.id === o.onlyDevice : s.id !== o.exceptDevice) &&
      (!to.size || to.has((s.member ?? "").trim().toLowerCase())) &&
      (o.kind === "test" || ({ ...DEFAULT_PREFS, ...s.prefs } as PushPrefs)[o.kind]),
  );
  const payload: Payload = { title: note.title, body: note.body, url, tag: o.key ?? `${o.kind}-${Date.now()}` };
  const results = await Promise.all(subs.map(async (s) => ({ device: s.id, ...(await sendTo(houseId, s, payload, o.kind === "ask" ? "high" : "normal")) })));
  return { sent: results.filter((r) => r.ok).length, kept, results: results.map(({ device, ok, status, error }) => ({ device, ok, status, error })) };
}

