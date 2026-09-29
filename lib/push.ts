"use client";

import type { HouseRef } from "./houses";

/**
 * Notifications on this device. On an iPhone or iPad they work only for the app on
 * the home screen (Safari → Deel → Zet op beginscherm, iOS 16.4 or later); on
 * Android and on a computer also in the browser.
 */

export interface Prefs {
  ask: boolean;
  updates: boolean;
  daily: boolean;
  /** When the planning of the day arrives ("08:00", this device's time). */
  dailyTime: string;
}
export const DEFAULT_PREFS: Prefs = { ask: true, updates: true, daily: true, dailyTime: "08:00" };

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode
  }
}

/** A random id for this device: its subscription, and "not to yourself". */
export function deviceId(): string {
  let id = read<string | null>("furnuture:device", null);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    write("furnuture:device", id);
  }
  return id;
}

/** Who uses this device ("Sanne"): the name others see. */
export const memberName = {
  get: () => read<string>("furnuture:member", ""),
  set: (name: string) => write("furnuture:member", name.trim().slice(0, 40)),
};

const prefsKey = (house: HouseRef) => `furnuture:push:${house.key}`;
/** This device's notification settings for a house (null: notifications not turned on). */
export const devicePrefs = {
  get: (house: HouseRef) => {
    const p = read<Partial<Prefs> | null>(prefsKey(house), null);
    return p ? { ...DEFAULT_PREFS, ...p } : null;
  },
  set: (house: HouseRef, prefs: Prefs | null) => (prefs ? write(prefsKey(house), prefs) : localStorage.removeItem(prefsKey(house))),
};

/** Headers on saves, so the server does not notify this device of its own changes. */
export const senderHeaders = (): Record<string, string> =>
  typeof window === "undefined" ? {} : { "x-device": deviceId(), "x-member": encodeURIComponent(memberName.get()) };

export interface Support {
  /** The browser can do push. */
  push: boolean;
  /** iPhone or iPad. */
  ios: boolean;
  /** Opened from the home screen (on iOS the only way to get notifications). */
  standalone: boolean;
  permission: NotificationPermission | "unsupported";
}

export function support(): Support {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const push = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { push, ios, standalone, permission: "Notification" in window ? Notification.permission : "unsupported" };
}

/** What the notifications card shows. */
export type PushStatus = "install" | "unsupported" | "denied" | "on" | "off";
export function pushStatus(house: HouseRef): PushStatus {
  const s = support();
  if (s.ios && !s.standalone) return "install";
  if (!s.push) return "unsupported";
  if (s.permission === "denied") return "denied";
  return s.permission === "granted" && devicePrefs.get(house) ? "on" : "off";
}

/** The service worker, registered once (it only handles notifications, not caching). */
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js").catch(() => null);
}

let server: Promise<{ publicKey: string | null; db: boolean }> | null = null;
/** Can the server send notifications (keys set in Vercel, and a database)? */
export function serverPush() {
  server ??= fetch("/api/push")
    .then((r) => r.json() as Promise<{ publicKey: string | null; db: boolean }>)
    .catch(() => ((server = null), { publicKey: null, db: false }));
  return server;
}

const bytes = (base64url: string) => {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function post(path: string, body: unknown, method = "POST") {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; sent?: number };
  if (!res.ok) throw new Error(data.error ?? `Fout ${res.status}`);
  return data;
}

/** Asks permission (must follow a tap) and registers this device for the house. */
export async function enablePush(house: HouseRef, prefs: Prefs): Promise<void> {
  if (!house.id) throw new Error("Meldingen werken alleen met online opslag.");
  // First, straight after the tap: Safari only asks for permission during a tap, not after waiting for the network.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Meldingen zijn geweigerd. Zet ze aan bij Instellingen → Meldingen → furnuture." : "Geen toestemming gekregen.");
  const { publicKey } = await serverPush();
  if (!publicKey) throw new Error("Meldingen zijn nog niet ingesteld op de server (VAPID-sleutels).");
  await registerWorker();
  const reg = await navigator.serviceWorker.ready;
  let sub: PushSubscription;
  try {
    sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(publicKey) }));
  } catch (e) {
    throw new Error(`Dit apparaat kon zich niet aanmelden voor meldingen (${e instanceof Error ? e.message : e}). Probeer het in de app op je beginscherm, of in Safari of Chrome.`);
  }
  await register(house, sub, prefs);
}

/** Tells the server about this device: its subscription, name, choices, time zone and time. */
async function register(house: HouseRef, sub: PushSubscription, prefs: Prefs) {
  await post(`/api/houses/${house.id}/push`, {
    device: deviceId(),
    member: memberName.get(),
    subscription: sub.toJSON(),
    prefs: { ask: prefs.ask, updates: prefs.updates, daily: prefs.daily },
    dailyTime: prefs.dailyTime,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam",
  });
  devicePrefs.set(house, prefs);
}

/**
 * On opening the app: iOS sometimes drops a subscription (an update, storage cleared).
 * Make a new one when it is gone, and tell the server again (also a new name or time zone).
 */
export async function ensurePush(house: HouseRef): Promise<void> {
  const prefs = devicePrefs.get(house);
  if (!prefs || !house.id || !support().push) return;
  if (Notification.permission !== "granted") {
    // Turned off in the iPhone settings: this device no longer gets anything.
    if (Notification.permission === "denied") await disablePush(house);
    return;
  }
  try {
    const { publicKey } = await serverPush();
    if (!publicKey) return;
    await registerWorker();
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(publicKey) }));
    await register(house, sub, prefs);
  } catch {
    // offline: next time
  }
}

/** Saves changed settings (or a new name) for a device that already has notifications on. */
export async function updatePush(house: HouseRef, prefs: Prefs): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || !house.id) return enablePush(house, prefs);
  await register(house, sub, prefs);
}

export async function disablePush(house: HouseRef): Promise<void> {
  if (house.id) await fetch(`/api/houses/${house.id}/push?device=${deviceId()}`, { method: "DELETE" }).catch(() => undefined);
  devicePrefs.set(house, null);
  // Other houses on this device share the subscription: only unsubscribe when none uses it.
  const stillUsed = Object.keys(localStorage).some((k) => k.startsWith("furnuture:push:"));
  if (!stillUsed) {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
    await sub?.unsubscribe().catch(() => undefined);
  }
}

/** A test to this device, after a few seconds: time to go to the home screen (iOS shows no banner while the app is open). */
export const sendTest = (house: HouseRef, delay = 5) => post(`/api/houses/${house.id}/notify`, { kind: "test", device: deviceId(), member: memberName.get(), delay });

/** The red number on the app icon goes when the app is opened. */
export function clearBadge() {
  (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined);
}

/** "Kun je hier even naar kijken?" to the other devices of the house. */
export const askToLook = (house: HouseRef, open: string, about: string, message: string, to: string[] = []) =>
  post(`/api/houses/${house.id}/notify`, { kind: "ask", device: deviceId(), member: memberName.get(), open, about, message, to });

/** The other people of the house (by name), to send a question to. */
export async function housemates(house: HouseRef): Promise<string[]> {
  if (!house.id) return [];
  const res = await fetch(`/api/houses/${house.id}/members`, { cache: "no-store" });
  if (!res.ok) return [];
  const me = memberName.get().trim().toLowerCase();
  return ((await res.json()) as { members: string[] }).members.filter((m) => m.trim().toLowerCase() !== me);
}

/** Is a notification meant for me: for everyone, sent by me, or with my name on it. */
export function forMe(n: Notice): boolean {
  if (!n.recipients?.length) return true;
  const me = memberName.get().trim().toLowerCase();
  return !me || n.member?.trim().toLowerCase() === me || n.recipients.some((r) => r.trim().toLowerCase() === me);
}

export interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  member: string | null;
  recipients?: string[] | null;
  created_at: string;
}

export async function notices(house: HouseRef): Promise<Notice[]> {
  if (!house.id) return [];
  const res = await fetch(`/api/houses/${house.id}/notifications`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fout ${res.status}`);
  return ((await res.json()) as { notifications: Notice[] }).notifications.filter(forMe);
}

const seenKey = (house: HouseRef) => `furnuture:seen:${house.key}`;
export const seen = {
  get: (house: HouseRef) => read<string>(seenKey(house), ""),
  set: (house: HouseRef, at: string) => write(seenKey(house), at),
};
