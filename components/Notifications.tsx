"use client";

import { Bell, BellRinging, BellSimpleSlash, ChatCircleText, Export, PaperPlaneTilt, PlusSquare } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import {
  askToLook,
  DEFAULT_PREFS,
  devicePrefs,
  disablePush,
  enablePush,
  memberName,
  notices,
  seen,
  sendTest,
  serverPush,
  support,
  updatePush,
  type Notice,
  type Prefs,
  type Support,
} from "@/lib/push";
import { useApp } from "./app";
import { I } from "./icons";
import { Sheet } from "./ui";

const PREF_LABELS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: "ask", label: "Vragen om mee te kijken", hint: "Als je partner wil dat je naar een product of klus kijkt." },
  { key: "updates", label: "Updates van je partner", hint: "Iets besteld, gekozen of binnen, een klus klaar, de planning verschoven." },
  { key: "daily", label: "Planning van de dag (8:00)", hint: "Wat je moet bestellen, wat morgen komt, welke klus morgen begint." },
];

/** Settings: who am I, turn notifications on, which ones. */
export function NotificationSettings() {
  const { house, toast } = useApp();
  const [s, setS] = useState<Support | null>(null);
  const [server, setServer] = useState<{ publicKey: string | null; db: boolean } | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(() => devicePrefs.get(house));
  const [name, setName] = useState(memberName.get);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setS(support());
    serverPush().then(setServer);
  }, []);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const on = !!prefs && s?.permission === "granted";
  const saveName = () => {
    memberName.set(name);
    if (on) run("name", () => updatePush(house, prefs!));
  };

  let body: React.ReactNode;
  if (!house.id || (server && !server.db)) body = <p className="tiny muted">Meldingen werken zodra de woning online bewaard wordt (Supabase gekoppeld).</p>;
  else if (server && !server.publicKey) body = <p className="tiny muted">Meldingen zijn nog niet ingesteld op de server: de VAPID-sleutels ontbreken in Vercel.</p>;
  else if (s && s.ios && !s.standalone)
    body = (
      <div className="advice small">
        <I icon={PlusSquare} size={16} />
        <span>
          Op een iPhone of iPad komen meldingen alleen via de app op je beginscherm: tik in Safari op <I icon={Export} size={14} /> <strong>Deel</strong> →{" "}
          <strong>Zet op beginscherm</strong>, open furnuture daar en zet hier meldingen aan. (iOS 16.4 of nieuwer.)
        </span>
      </div>
    );
  else if (s && !s.push) body = <p className="tiny muted">Deze browser kan geen meldingen ontvangen.</p>;
  else
    body = (
      <>
        {on ? (
          <div className="stack tight">
            {PREF_LABELS.map((p) => (
              <label key={p.key} className="row top" style={{ gap: 10 }}>
                <input
                  type="checkbox"
                  checked={prefs![p.key]}
                  onChange={(e) => {
                    const next = { ...prefs!, [p.key]: e.target.checked };
                    setPrefs(next);
                    run("prefs", () => updatePush(house, next));
                  }}
                  style={{ marginTop: 3 }}
                />
                <span className="stack" style={{ gap: 0 }}>
                  <span className="small strong">{p.label}</span>
                  <span className="tiny muted">{p.hint}</span>
                </span>
              </label>
            ))}
            <div className="row wrap-row">
              <button className="small" disabled={!!busy} onClick={() => run("test", async () => (await sendTest(house)).sent ? toast("Testmelding verstuurd") : setError("Niet aangekomen: zet meldingen uit en weer aan."))}>
                {busy === "test" ? <span className="spinner" /> : <I icon={PaperPlaneTilt} />} Testmelding
              </button>
              <button
                className="small ghost"
                disabled={!!busy}
                onClick={() =>
                  run("off", async () => {
                    await disablePush(house);
                    setPrefs(null);
                  })
                }
              >
                <I icon={BellSimpleSlash} /> Uitzetten
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              className="primary"
              disabled={!!busy || !name.trim()}
              onClick={() =>
                run("on", async () => {
                  memberName.set(name);
                  await enablePush(house, prefs ?? DEFAULT_PREFS);
                  setPrefs(prefs ?? DEFAULT_PREFS);
                  toast("Meldingen staan aan");
                })
              }
            >
              {busy === "on" ? <span className="spinner" /> : <I icon={BellRinging} />} Meldingen aanzetten
            </button>
            {!name.trim() && <p className="tiny muted" style={{ marginTop: 6 }}>Vul eerst je naam in.</p>}
          </div>
        )}
      </>
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

/** "Vraag om mee te kijken": a notification to the other devices of the house. */
export function AskButton({ open, about }: { open: string; about: string }) {
  const { house, toast } = useApp();
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!house.id) return null;
  if (!form)
    return (
      <button className="small soft" onClick={() => setForm(true)}>
        <I icon={ChatCircleText} /> Vraag om mee te kijken
      </button>
    );
  return (
    <form
      className="stack tight ask-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (!memberName.get()) throw new Error("Vul eerst je naam in bij Instellingen → Meldingen.");
          const r = await askToLook(house, open, about, message);
          toast(r.sent ? "Gevraagd: je partner krijgt een melding" : "Verstuurd: je partner ziet het bij het belletje (op hun telefoon staan meldingen nog niet aan)");
          setForm(false);
          setMessage("");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        Bericht erbij <span className="tiny">(mag leeg)</span>
        <input autoFocus maxLength={200} placeholder="Bijv. deze of de grijze? Vind jij hem mooi?" value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="row wrap-row">
        <button className="primary small" disabled={busy}>
          {busy ? <span className="spinner" /> : <I icon={PaperPlaneTilt} />} Versturen
        </button>
        <button type="button" className="small ghost" onClick={() => setForm(false)}>
          Annuleren
        </button>
      </div>
      {error && <p className="small error">{error}</p>}
    </form>
  );
}

/** The bell in the header: the latest notifications of this house, with a dot for new ones. */
export function NotificationBell({ onOpen }: { onOpen: (url: string) => void }) {
  const { house } = useApp();
  const [list, setList] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => seen.get(house));
  // While the list is open, what was new stays marked.
  const [since, setSince] = useState("");

  const load = useCallback(() => void notices(house).then(setList), [house]);
  useEffect(() => {
    if (!house.id) return;
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [house.id, load]);

  if (!house.id) return null;
  const me = memberName.get();
  const unread = list.filter((n) => n.created_at > lastSeen && (!me || n.member !== me)).length;
  return (
    <>
      <button
        className="ghost icon bell"
        aria-label={unread ? `Meldingen, ${unread} nieuw` : "Meldingen"}
        onClick={() => {
          setOpen(true);
          setSince(lastSeen);
          load();
          if (list[0]) {
            seen.set(house, list[0].created_at);
            setLastSeen(list[0].created_at);
          }
        }}
      >
        <I icon={Bell} size={22} />
        {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <Sheet title="Meldingen" onClose={() => setOpen(false)} footer={<button className="primary" onClick={() => setOpen(false)}>Klaar</button>}>
          {list.length ? (
            <div className="items">
              {list.map((n) => (
                <button
                  key={n.id}
                  className={`notice${n.created_at > since ? " new" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (n.url) onOpen(n.url);
                  }}
                >
                  <span className="grow stack tight">
                    <strong className="small">{n.title}</strong>
                    {n.body && <span className="tiny muted pre">{n.body}</span>}
                  </span>
                  <span className="tiny muted nowrap">{ago(n.created_at)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">Nog geen meldingen. Hier komt wat je partner vraagt of verandert, en de planning van de dag.</p>
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
