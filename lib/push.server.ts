import webpush from "web-push";
import { DEFAULT_PREFS, logNotification, removeEndpoint, subscriptionsOf, type PushPrefs } from "./db/supabase";
import { noteUrl, type Note } from "./notify";

/**
 * Web Push (works on iPhone and iPad for apps on the home screen, iOS 16.4+, and on
 * Android and desktop browsers). The keys are set in Vercel: VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: address). Server only.
 */

function keys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || "mailto:furnuture@example.com" };
}
export const pushConfigured = () => !!keys();
export const publicKey = () => keys()?.publicKey ?? null;

export interface SendOptions {
  kind: keyof PushPrefs | "test";
  houseName: string;
  /** Not to this device (the one that caused it). */
  exceptDevice?: string;
  /** Only to this device (a test). */
  onlyDevice?: string;
  member?: string;
  device?: string;
  /** Sent once: a second call with the same key does nothing. */
  key?: string;
}

/** Keeps the notification (the list in the app) and sends it to the house's devices that want this kind. */
export async function sendToHouse(houseId: string, note: Note, o: SendOptions): Promise<{ sent: number; kept: boolean }> {
  const url = noteUrl(o.houseName, note.open);
  const kept = await logNotification(houseId, { kind: o.kind, title: note.title, body: note.body, url, member: o.member ?? null, device: o.device ?? null, key: o.key ?? null });
  if (!kept) return { sent: 0, kept };
  const k = keys();
  if (!k) return { sent: 0, kept };
  webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);
  const subs = (await subscriptionsOf(houseId)).filter(
    (s) => (o.onlyDevice ? s.id === o.onlyDevice : s.id !== o.exceptDevice) && (o.kind === "test" || ({ ...DEFAULT_PREFS, ...s.prefs } as PushPrefs)[o.kind]),
  );
  const payload = JSON.stringify({ title: note.title, body: note.body, url, tag: o.key ?? `${o.kind}-${Date.now()}` });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: o.kind === "ask" ? "high" : "normal" });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // Gone: the app was removed or notifications were turned off on that device.
        if (status === 404 || status === 410) await removeEndpoint(houseId, s.endpoint).catch(() => undefined);
      }
    }),
  );
  return { sent, kept };
}
