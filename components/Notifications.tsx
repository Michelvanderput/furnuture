"use client";

import { ArrowsClockwise, Bell, BellRinging, BellSimpleSlash, CalendarCheck, ChatCircleText, Export, GearSix, PaperPlaneTilt, PlusSquare, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import {
  askToLook,
  DEFAULT_PREFS,
  devicePrefs,
  disablePush,
  enablePush,
  housemates,
  memberName,
  notices,
  seen,
  sendTest,
  serverPush,
  pushStatus,
  updatePush,
  type Notice,
  type Prefs,
  type PushStatus,
} from "@/lib/push";
import { useApp } from "./app";
import { I } from "./icons";
import { Sheet } from "./ui";

const PREF_LABELS: { key: "ask" | "updates" | "daily"; label: string; hint: string }[] = [
  { key: "ask", label: "Vragen om mee te kijken", hint: "Als je partner wil dat je naar een product of klus kijkt." },
  { key: "updates", label: "Updates van je partner", hint: "Iets besteld, gekozen of binnen, een klus klaar, de planning verschoven." },
  { key: "daily", label: "Planning van de dag", hint: "Wat je moet bestellen, wat morgen komt, welke klus morgen begint. Alleen op dagen dat er iets is." },
];

/** Settings: who am I, turn notifications on, which ones and when. */
export function NotificationSettings() {
  const { house, toast } = useApp();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [server, setServer] = useState<{ publicKey: string | null; db: boolean } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => devicePrefs.get(house) ?? DEFAULT_PREFS);
  const [name, setName] = useState(memberName.get);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setStatus(pushStatus(house));
    serverPush().then(setServer);
  }, [house]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      setStatus(pushStatus(house));
    }
  }

  const on = status === "on";
  const change = (next: Prefs) => {
    setPrefs(next);
    if (on) run("prefs", () => updatePush(house, next));
  };
  const saveName = () => {
    memberName.set(name);
    if (on) run("name", () => updatePush(house, prefs));
  };

  let body: React.ReactNode;
  if (!house.id || (server && !server.db)) body = <p className="tiny muted">Meldingen werken zodra de woning online bewaard wordt (Supabase gekoppeld).</p>;
  else if (server && !server.publicKey) body = <p className="tiny muted">Meldingen zijn nog niet ingesteld op de server: de VAPID-sleutels ontbreken in Vercel.</p>;
  else if (status === "install")
    body = (
      <div className="advice small">
        <I icon={PlusSquare} size={16} />
        <span>
          Op een iPhone of iPad komen meldingen alleen via de app op je beginscherm: tik in Safari op <I icon={Export} size={14} /> <strong>Deel</strong> →{" "}
          <strong>Zet op beginscherm</strong>, open furnuture via het icoon en zet hier meldingen aan. (iOS 16.4 of nieuwer.)
        </span>
      </div>
    );
  else if (status === "unsupported") body = <p className="tiny muted">Deze browser of iOS-versie kan geen meldingen ontvangen (op iPhone: iOS 16.4 of nieuwer).</p>;
  else if (status === "denied")
    body = (
      <div className="advice small warn">
        <I icon={BellSimpleSlash} size={16} />
        <span>
          Meldingen zijn geblokkeerd. Zet ze aan in <strong>Instellingen → Meldingen → furnuture</strong> (iPhone) of in de site-instellingen van je browser, en kom
          dan hier terug.
        </span>
      </div>
    );
  else
    body = (
      <div className="stack tight">
        {PREF_LABELS.map((p) => (
          <label key={p.key} className="row top" style={{ gap: 10 }}>
            <input type="checkbox" checked={prefs[p.key]} onChange={(e) => change({ ...prefs, [p.key]: e.target.checked })} style={{ marginTop: 3 }} />
            <span className="stack grow" style={{ gap: 0 }}>
              <span className="small strong">{p.label}</span>
              <span className="tiny muted">{p.hint}</span>
            </span>
            {p.key === "daily" && (
              <input
                type="time"
                aria-label="Tijd van de planning van de dag"
                style={{ width: 110 }}
                disabled={!prefs.daily}
                value={prefs.dailyTime}
                onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && change({ ...prefs, dailyTime: e.target.value })}
              />
            )}
          </label>
        ))}
        {on ? (
          <div className="row wrap-row">
            <button
              className="small"
              disabled={!!busy}
              onClick={() =>
                run("test", async () => {
                  toast("De testmelding komt over 5 seconden: ga naar je beginscherm");
                  const r = await sendTest(house);
                  if (!r.sent) throw new Error("Niet aangekomen. Zet meldingen uit en weer aan.");
                })
              }
            >
              {busy === "test" ? <span className="spinner" /> : <I icon={PaperPlaneTilt} />} Testmelding
            </button>
            <button className="small ghost" disabled={!!busy} onClick={() => run("off", () => disablePush(house))}>
              <I icon={BellSimpleSlash} /> Uitzetten
            </button>
          </div>
        ) : (
          <div>
            <button
              className="primary"
              disabled={!!busy || !name.trim()}
              onClick={() =>
                run("on", async () => {
                  memberName.set(name);
                  await enablePush(house, prefs);
                  toast("Meldingen staan aan");
                })
              }
            >
              {busy === "on" ? <span className="spinner" /> : <I icon={BellRinging} />} Meldingen aanzetten
            </button>
            {!name.trim() && (
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Vul eerst je naam in.
              </p>
            )}
          </div>
        )}
      </div>
    );

  return (
    <div className="stack tight">
      <strong>Meldingen</strong>
      <label className="field">
        Je naam <span className="tiny">(zo zien anderen van wie iets komt)</span>
        <input placeholder="Bijv. Michel" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
      </label>
      {body}
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A suggestion on the overview, only where notifications can actually work; can be closed for good. */
export function NotificationSuggestion() {
  const { house, openSettings } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!house.id || localStorage.getItem("furnuture:push-hint-closed")) return;
    const st = pushStatus(house);
    if (st !== "off" && st !== "install") return;
    serverPush().then((s) => setShow(!!s.publicKey));
  }, [house]);
  if (!show) return null;
  const install = pushStatus(house) === "install";
  return (
    <div className="card row wrap-row" style={{ gap: 12, borderColor: "color-mix(in srgb, var(--accent) 35%, var(--line))" }}>
      <span className="icon-badge accent">
        <I icon={BellRinging} size={20} />
      </span>
      <span className="grow stack" style={{ gap: 2, minWidth: 200 }}>
        <strong className="small">Meldingen op je telefoon</strong>
        <span className="tiny muted">
          {install ? "Zet furnuture op je beginscherm (Deel → Zet op beginscherm) en open het daar: dan kunnen we je iets laten weten." : "Als je partner wil dat je ergens naar kijkt, iets besteld is of een klus begint."}
        </span>
      </span>
      {!install && (
        <button className="small primary" onClick={openSettings}>
          Aanzetten
        </button>
      )}
      <button
        className="small icon ghost"
        aria-label="Sluiten"
        onClick={() => {
          localStorage.setItem("furnuture:push-hint-closed", "1");
          setShow(false);
        }}
      >
        <I icon={X} />
      </button>
    </div>
  );
}

/** "Vraag om mee te kijken": a notification to everyone else in the house, or to the people you pick. */
export function AskButton({ open, about }: { open: string; about: string }) {
  const { house, toast } = useApp();
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState("");
  const [people, setPeople] = useState<string[] | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!house.id) return null;
  if (!form)
    return (
      <button
        className="small soft"
        onClick={() => {
          setForm(true);
          housemates(house).then(setPeople);
        }}
      >
        <I icon={ChatCircleText} /> Vraag om mee te kijken
      </button>
    );
  const toggle = (name: string) => setTo(to.includes(name) ? to.filter((n) => n !== name) : [...to, name]);
  return (
    <form
      className="stack tight ask-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (!memberName.get()) throw new Error("Vul eerst je naam in bij Instellingen → Meldingen.");
          const r = await askToLook(house, open, about, message, to);
          const whom = to.length ? to.join(" en ") : "je huisgenoten";
          toast(r.sent ? `Gevraagd: ${whom} krijg${to.length === 1 ? "t" : "en"} een melding` : `Verstuurd: ${whom} ziet het bij het belletje (meldingen staan daar nog niet aan)`);
          setForm(false);
          setMessage("");
          setTo([]);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        Naar wie?
        <div className="row wrap-row" style={{ gap: 6 }}>
          <button type="button" className={`chip pick${to.length === 0 ? " on" : ""}`} aria-pressed={to.length === 0} onClick={() => setTo([])}>
            Iedereen
          </button>
          {people === null ? (
            <span className="tiny muted">laden…</span>
          ) : (
            people.map((p) => (
              <button key={p} type="button" className={`chip pick${to.includes(p) ? " on" : ""}`} aria-pressed={to.includes(p)} onClick={() => toggle(p)}>
                {p}
              </button>
            ))
          )}
        </div>
        {people && people.length === 0 && <span className="tiny muted">Nog niemand anders met een naam: je bericht gaat naar iedereen in deze woning.</span>}
      </div>
      <label className="field">
        Bericht erbij <span className="tiny">(mag leeg)</span>
        <input autoFocus maxLength={200} placeholder="Bijv. deze of de grijze? Vind jij hem mooi?" value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="row wrap-row">
        <button className="primary small" disabled={busy}>
          {busy ? <span className="spinner" /> : <I icon={PaperPlaneTilt} />} {to.length ? `Naar ${to.join(" en ")}` : "Naar iedereen"}
        </button>
        <button type="button" className="small ghost" onClick={() => setForm(false)}>
          Annuleren
        </button>
      </div>
      {error && <p className="small error">{error}</p>}
    </form>
  );
}

const KIND_ICON: Record<string, typeof Bell> = { ask: ChatCircleText, updates: ArrowsClockwise, daily: CalendarCheck, test: PaperPlaneTilt };
const WEEK = 7 * 86_400_000;

/** The bell in the header: the latest notifications of this house, with the number of new ones. */
export function NotificationBell({ onOpen }: { onOpen: (url: string) => void }) {
  const { house, openSettings } = useApp();
  const [list, setList] = useState<Notice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => seen.get(house));
  // While the list is open, what was new stays marked.
  const [since, setSince] = useState("");

  const load = useCallback(async () => {
    try {
      const l = await notices(house);
      setList(l);
      setFailed(false);
      return l;
    } catch {
      setFailed(true);
      return null;
    }
  }, [house]);
  useEffect(() => {
    if (!house.id) return;
    load();
    const onPush = () => void load();
    window.addEventListener("furnuture:push", onPush);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("furnuture:push", onPush);
      clearInterval(timer);
    };
  }, [house.id, load]);

  if (!house.id) return null;
  const me = memberName.get();
  // Never looked (a new device): only the last week counts as new, not everything from before.
  const cutoff = lastSeen || new Date(Date.now() - WEEK).toISOString();
  const isNew = (n: Notice, from: string) => n.created_at > from && (!me || n.member !== me);
  const unread = (list ?? []).filter((n) => isNew(n, cutoff)).length;
  const markSeen = (l: Notice[] | null) => {
    const newest = l?.[0]?.created_at;
    if (newest && newest > (lastSeen || "")) {
      seen.set(house, newest);
      setLastSeen(newest);
    }
  };

  return (
    <>
      <button
        className="ghost icon bell"
        aria-label={unread ? `Meldingen, ${unread} nieuw` : "Meldingen"}
        title="Meldingen"
        onClick={async () => {
          setSince(cutoff);
          setOpen(true);
          markSeen(list);
          markSeen(await load());
        }}
      >
        <I icon={Bell} size={22} weight={unread ? "fill" : "regular"} />
        {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <Sheet
          title="Meldingen"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button
                className="ghost"
                onClick={() => {
                  setOpen(false);
                  openSettings();
                }}
              >
                <I icon={GearSix} /> Instellen
              </button>
              <span className="grow" />
              <button className="primary" onClick={() => setOpen(false)}>
                Klaar
              </button>
            </>
          }
        >
          {failed && <p className="small error">De meldingen konden niet geladen worden. Probeer het zo nog eens.</p>}
          {list === null && !failed ? (
            <p className="muted small row" style={{ gap: 8 }}>
              <span className="spinner" /> Laden…
            </p>
          ) : list && list.length ? (
            <div className="notice-list">
              {list.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell;
                return (
                  <button
                    key={n.id}
                    className={`notice${isNew(n, since) ? " new" : ""}`}
                    disabled={!n.url}
                    onClick={() => {
                      setOpen(false);
                      if (n.url) onOpen(n.url);
                    }}
                  >
                    <span className={`notice-icon kind-${n.kind}`}>
                      <I icon={Icon} size={18} />
                    </span>
                    <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                      <strong className="small">{n.title}</strong>
                      {n.body && <span className="tiny muted pre">{n.body}</span>}
                    </span>
                    <span className="tiny muted nowrap">{ago(n.created_at)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            !failed && (
              <div className="empty small">
                <I icon={Bell} size={28} />
                <span>Nog geen meldingen. Hier komt wat je partner vraagt of verandert, en de planning van de dag.</span>
              </div>
            )
          )}
        </Sheet>
      )}
    </>
  );
}

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "nu";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} u`;
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}
