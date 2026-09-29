"use client";

import {
  CalendarBlank,
  CalendarPlus,
  CaretLeft,
  CaretRight,
  CheckCircle,
  DownloadSimple,
  Hammer,
  Key,
  LinkSimple,
  ListBullets,
  Package,
  Rows,
  ShoppingCart,
  Truck,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { agenda, dayLabel, monthGrid, monthLabel, monthOf, onDay, shiftMonth, toIcs, weekLabel, weekStart, type AgendaEvent, type EventKind, type Unplanned } from "@/lib/agenda";
import { addDays, roomReady, shortDate } from "@/lib/delivery";
import { patchItem } from "@/lib/items";
import { daysBetween, renovationOf, today } from "@/lib/renovation";
import { patchRenovation, patchTask } from "@/lib/tasks";
import { useApp } from "./app";
import { DateBox } from "./Delivery";
import { I } from "./icons";

type View = "agenda" | "maand" | "kamers";
const VIEW_KEY = "furnuture:planning-view";

const KIND: Record<EventKind, { label: string; icon: Icon }> = {
  mijlpaal: { label: "Mijlpalen", icon: Key },
  klus: { label: "Klussen", icon: Hammer },
  levering: { label: "Leveringen", icon: Package },
  bestellen: { label: "Bestellen", icon: ShoppingCart },
};
const FILTERS: EventKind[] = ["klus", "levering", "bestellen"];

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "maand" || v === "kamers" ? v : "agenda";
  } catch {
    return "agenda";
  }
}

/** Everything with a date: jobs, deliveries, what to order, key and moving day. */
export function PlanningView() {
  const { project, update, house, toast } = useApp();
  const now = today();
  const r = renovationOf(project);
  const { events, unplanned, attention } = useMemo(() => agenda(project, now), [project, now]);
  const [view, setViewState] = useState<View>(readView);
  const [kinds, setKinds] = useState<Set<EventKind>>(new Set(FILTERS));
  const [room, setRoom] = useState("");
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // private mode
    }
  };

  const shown = events.filter((e) => (e.kind === "mijlpaal" || kinds.has(e.kind)) && (!room || (room === "huis" ? !e.roomIds.length : e.roomIds.includes(room)) || e.kind === "mijlpaal"));
  const upcoming = events.filter((e) => (e.end ?? e.date) >= now && e.tone !== "done" && e.kind !== "mijlpaal");
  const nextWeek = upcoming.filter((e) => e.date <= addDays(now, 7)).length;
  const calendarUrl = house.id && typeof location !== "undefined" ? `${location.host}/api/houses/${house.id}/agenda.ics` : null;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Planning</h1>
          <p className="lead">
            {upcoming.length ? `${upcoming.length} dingen gepland · ${nextWeek} in de komende 7 dagen` : "Nog niets met een datum: plan klussen, zet levertijden of bestel iets."}
          </p>
        </div>
        <div className="row wrap-row">
          {calendarUrl ? (
            <>
              <a className="btn primary" href={`webcal://${calendarUrl}`}>
                <I icon={CalendarPlus} /> In je agenda
              </a>
              <button
                className="icon"
                aria-label="Agendalink kopiëren"
                title="Agendalink kopiëren (voor Google Agenda of Outlook: 'Agenda toevoegen via URL')"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`https://${calendarUrl}`);
                    toast("Agendalink gekopieerd");
                  } catch {
                    toast(`https://${calendarUrl}`);
                  }
                }}
              >
                <I icon={LinkSimple} />
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                const blob = new Blob([toIcs(events, house.name)], { type: "text/calendar" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "furnuture-planning.ics";
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              }}
            >
              <I icon={DownloadSimple} /> Agendabestand
            </button>
          )}
        </div>
      </div>

      <div className="countdowns">
        <DateBox icon={Key} label="Sleutel" date={r.keyDate} days={r.keyDate ? daysBetween(now, r.keyDate) : undefined} onChange={(keyDate) => update(patchRenovation({ keyDate }))} />
        <DateBox
          icon={Truck}
          label="Verhuizing"
          date={r.moveDate}
          days={r.moveDate ? daysBetween(now, r.moveDate) : undefined}
          min={r.keyDate}
          onChange={(moveDate) => update(patchRenovation({ moveDate }))}
        />
      </div>

      {attention.length > 0 && (
        <div className="card stack tight attention">
          <strong className="row" style={{ gap: 8 }}>
            <I icon={Warning} size={18} weight="bold" /> {attention.length} aandachtspunt{attention.length > 1 ? "en" : ""}
          </strong>
          {attention.slice(0, 6).map((e) => (
            <EventRow key={e.id} e={e} compact />
          ))}
        </div>
      )}

      <div className="row wrap-row between planning-controls">
        <div className="segmented" role="tablist" aria-label="Weergave">
          {(
            [
              ["agenda", "Agenda", ListBullets],
              ["maand", "Maand", CalendarBlank],
              ["kamers", "Per kamer", Rows],
            ] as const
          ).map(([v, label, icon]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              <I icon={icon} size={16} /> {label}
            </button>
          ))}
        </div>
        <div className="row wrap-row" style={{ gap: 6 }}>
          {FILTERS.map((k) => {
            const on = kinds.has(k);
            return (
              <button
                key={k}
                className={`chip kind-${k}${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(kinds);
                  if (on) next.delete(k);
                  else next.add(k);
                  setKinds(next.size ? next : new Set(FILTERS));
                }}
              >
                <I icon={KIND[k].icon} size={14} /> {KIND[k].label}
              </button>
            );
          })}
          {view !== "kamers" && (
            <select aria-label="Kamer" value={room} onChange={(e) => setRoom(e.target.value)} style={{ width: "auto", minHeight: 36 }}>
              <option value="">Alle kamers</option>
              <option value="huis">Hele huis</option>
              {project.rooms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {view === "agenda" && <AgendaList events={shown} now={now} />}
      {view === "maand" && <MonthView events={shown} now={now} />}
      {view === "kamers" && <RoomsTimeline events={shown} now={now} />}

      {unplanned.length > 0 && <UnplannedList list={unplanned} onTask={(id, start) => update(patchTask(id, { start }))} onItem={(id, patch) => update(patchItem(id, patch))} />}
    </section>
  );
}

// ---------------------------------------------------------------------------

function EventRow({ e, compact }: { e: AgendaEvent; compact?: boolean }) {
  const { openItem, openTask } = useApp();
  const open = () => {
    if (!e.open) return;
    const [kind, id] = e.open.split(":");
    if (kind === "item") openItem(id);
    else openTask(id);
  };
  const icon = e.kind === "mijlpaal" ? (e.id === "verhuizing" ? Truck : Key) : KIND[e.kind].icon;
  return (
    <button className={`event tone-${e.tone} kind-${e.kind}${compact ? " compact" : ""}`} onClick={open} disabled={!e.open}>
      <span className="event-icon">
        <I icon={e.tone === "done" ? CheckCircle : icon} size={18} weight={e.tone === "done" ? "fill" : "regular"} />
      </span>
      <span className="grow stack" style={{ gap: 1, minWidth: 0 }}>
        <span className="event-title">{e.title}</span>
        {(e.sub || e.end || compact) && (
          <span className="tiny muted">
            {[compact ? shortDate(e.date) : undefined, e.end ? `t/m ${shortDate(e.end)}` : undefined, e.sub].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}

/** Week by week from now; what is past folds away. */
function AgendaList({ events, now }: { events: AgendaEvent[]; now: string }) {
  const [past, setPast] = useState(false);
  const isPast = (e: AgendaEvent) => (e.end ?? e.date) < now;
  const earlier = events.filter(isPast);
  const list = past ? events : events.filter((e) => !isPast(e));
  if (!events.length) return <p className="empty small">Nog niets in de planning met deze filters.</p>;

  const weeks = new Map<string, Map<string, AgendaEvent[]>>();
  for (const e of list) {
    // A job that started before today is shown today ("loopt nog").
    const day = e.date < now && !isPast(e) ? now : e.date;
    const w = weekStart(day);
    const days = weeks.get(w) ?? new Map<string, AgendaEvent[]>();
    days.set(day, [...(days.get(day) ?? []), e]);
    weeks.set(w, days);
  }
  return (
    <div className="stack agenda">
      {earlier.length > 0 && (
        <button className="ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setPast(!past)}>
          {past ? "Verberg wat voorbij is" : `Toon wat voorbij is (${earlier.length})`}
        </button>
      )}
      {[...weeks].map(([w, days]) => (
        <div key={w} className="stack tight">
          <span className="eyebrow">{weekLabel(w, now)}</span>
          <div className="card flat agenda-week">
            {[...days].map(([day, list]) => (
              <div key={day} className={`agenda-day${day === now ? " today" : ""}${day < now ? " past" : ""}`}>
                <div className="agenda-date">{dayLabel(day, now)}</div>
                <div className="stack tight grow">
                  {list.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A month calendar; tap a day for what happens then. */
function MonthView({ events, now }: { events: AgendaEvent[]; now: string }) {
  const [month, setMonth] = useState(monthOf(now));
  const [picked, setPicked] = useState<string>(now);
  const days = monthGrid(month);
  const on = (day: string) => events.filter((e) => onDay(e, day));
  return (
    <div className="stack">
      <div className="row between">
        <button className="icon ghost" aria-label="Vorige maand" onClick={() => setMonth(shiftMonth(month, -1))}>
          <I icon={CaretLeft} />
        </button>
        <strong className="month-title">{monthLabel(month)}</strong>
        <button className="icon ghost" aria-label="Volgende maand" onClick={() => setMonth(shiftMonth(month, 1))}>
          <I icon={CaretRight} />
        </button>
      </div>
      <div className="month" role="grid" aria-label={monthLabel(month)}>
        {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
          <span key={d} className="month-dow">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const list = on(day);
          const other = monthOf(day) !== month;
          return (
            <button
              key={day}
              className={`month-day${other ? " other" : ""}${day === now ? " today" : ""}${day === picked ? " picked" : ""}`}
              onClick={() => setPicked(day)}
              aria-label={`${dayLabel(day, now)}: ${list.length ? list.map((e) => e.title).join(", ") : "niets"}`}
            >
              <span className="num">{Number(day.slice(8))}</span>
              <span className="pills">
                {list.slice(0, 3).map((e) => (
                  <span key={e.id} className={`pill tone-${e.tone} kind-${e.kind}`}>
                    {e.kind === "mijlpaal" ? (e.id === "verhuizing" ? "Verhuizen" : "Sleutel") : e.title}
                  </span>
                ))}
                {list.length > 3 && <span className="more">+{list.length - 3}</span>}
              </span>
              <span className="dots" aria-hidden>
                {list.slice(0, 4).map((e) => (
                  <i key={e.id} className={`tone-${e.tone} kind-${e.kind}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="stack tight">
        <span className="eyebrow">{dayLabel(picked, now)}</span>
        {on(picked).length ? on(picked).map((e) => <EventRow key={e.id} e={e} />) : <p className="small muted">Niets gepland.</p>}
      </div>
    </div>
  );
}

/** One line per room: jobs as bars, deliveries as dots, order-by days as rings, and when the room is ready. */
function RoomsTimeline({ events, now }: { events: AgendaEvent[]; now: string }) {
  const { project, openItem, openTask } = useApp();
  const r = renovationOf(project);
  const dated = events.filter((e) => e.kind !== "mijlpaal");
  const all = [now, r.keyDate, r.moveDate, ...dated.flatMap((e) => [e.date, e.end])].filter((d): d is string => !!d).sort();
  const from = weekStart(all[0] < now ? addDays(now, -7) : all[0]);
  let to = addDays(all.at(-1)!, 7);
  if (daysBetween(from, to) < 42) to = addDays(from, 42);
  const span = daysBetween(from, to);
  const x = (d: string) => `${(daysBetween(from, d) / span) * 100}%`;
  const w = (a: string, b: string) => `${Math.max(((daysBetween(a, b) + 1) / span) * 100, 1)}%`;
  const mondays: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) mondays.push(d);
  const step = span > 150 ? 4 : span > 75 ? 2 : 1;

  const lanes = [
    ...project.rooms.map((room) => ({ key: room.id, name: room.name, list: dated.filter((e) => e.roomIds.includes(room.id)), ready: roomReady(project, room.id).date })),
    { key: "huis", name: "Hele huis", list: dated.filter((e) => !e.roomIds.length), ready: undefined },
  ].filter((l) => l.list.length);
  const open = (e: AgendaEvent) => {
    const [kind, id] = (e.open ?? "").split(":");
    if (kind === "item") openItem(id);
    else if (kind === "task") openTask(id);
  };

  if (!lanes.length) return <p className="empty small">Nog niets met een datum.</p>;
  return (
    <div className="card flat room-timeline">
      <div className="rt-row rt-scale">
        <span className="rt-label" />
        <div className="rt-track">
          {mondays
            .filter((_, i) => i % step === 0)
            .map((d) => (
              <span key={d} style={{ left: x(d) }}>
                {shortDate(d)}
              </span>
            ))}
        </div>
      </div>
      {lanes.map((l) => (
        <div key={l.key} className="rt-row">
          <span className="rt-label">
            <strong className="clip">{l.name}</strong>
            {l.ready && <span className="tiny muted">klaar {shortDate(l.ready)}</span>}
          </span>
          <div className="rt-track">
            {mondays.map((d) => (
              <i key={d} className="plan-grid" style={{ left: x(d) }} />
            ))}
            {l.list
              .filter((e) => e.kind === "klus")
              .map((e) => (
                <button key={e.id} className={`rt-bar tone-${e.tone}`} style={{ left: x(e.date), width: w(e.date, e.end ?? e.date) }} onClick={() => open(e)} title={`${e.title}: ${shortDate(e.date)}${e.end ? ` – ${shortDate(e.end)}` : ""}`}>
                  <span>{e.title}</span>
                </button>
              ))}
            {l.list
              .filter((e) => e.kind !== "klus")
              .map((e) => (
                <button
                  key={e.id}
                  className={`plan-dot rt-dot tone-${e.tone}${e.kind === "bestellen" ? " order" : ""}`}
                  style={{ left: x(e.date) }}
                  onClick={() => open(e)}
                  title={`${shortDate(e.date)}: ${e.title}`}
                  aria-label={`${shortDate(e.date)}: ${e.title}`}
                />
              ))}
            <i className="plan-mark now" style={{ left: x(now) }} />
            {r.keyDate && <i className="plan-mark key" style={{ left: x(r.keyDate) }} />}
            {r.moveDate && <i className="plan-mark move" style={{ left: x(r.moveDate) }} />}
          </div>
        </div>
      ))}
      <div className="plan-legend tiny muted">
        <span>
          <i className="lg bar todo" /> klus, nog regelen
        </span>
        <span>
          <i className="lg bar" /> klus gepland
        </span>
        <span>
          <i className="lg dot" /> levering
        </span>
        <span>
          <i className="lg ring" /> uiterlijk bestellen
        </span>
        <span>
          <i className="lg line key" /> sleutel
        </span>
        <span>
          <i className="lg line move" /> verhuizing
        </span>
      </div>
    </div>
  );
}

/** What has no date yet, with the date to fill in right here. */
function UnplannedList({ list, onTask, onItem }: { list: Unplanned[]; onTask: (id: string, start?: string) => void; onItem: (id: string, patch: { deliveryDate?: string; leadDays?: number }) => void }) {
  const { openItem, openTask, project } = useApp();
  const rooms = (ids: string[]) => (ids.length ? ids.map((id) => project.rooms.find((r) => r.id === id)?.name).filter(Boolean).join(", ") : "Hele huis");
  return (
    <div className="stack tight">
      <span className="eyebrow">Nog in te plannen ({list.length})</span>
      <div className="card flat unplanned">
        {list.map((u) => (
          <div key={`${u.kind}:${u.id}`} className="unplanned-row">
            <button className="grow stack plain" style={{ gap: 1, minWidth: 0, textAlign: "left" }} onClick={() => (u.kind === "klus" ? openTask(u.id) : openItem(u.id))}>
              <span className="event-title">
                <I icon={u.kind === "klus" ? Hammer : Package} size={15} /> {u.title}
              </span>
              <span className="tiny muted">
                {rooms(u.roomIds)} · {u.why}
              </span>
            </button>
            {u.kind === "klus" && <input type="date" aria-label={`Startdatum ${u.title}`} onChange={(e) => e.target.value && onTask(u.id, e.target.value)} />}
            {u.kind === "levering" && <input type="date" aria-label={`Leverdatum ${u.title}`} onChange={(e) => e.target.value && onItem(u.id, { deliveryDate: e.target.value })} />}
            {u.kind === "levertijd" && (
              <select aria-label={`Levertijd ${u.title}`} defaultValue="" onChange={(e) => e.target.value && onItem(u.id, { leadDays: Number(e.target.value) })}>
                <option value="">Levertijd…</option>
                <option value="3">± 3 dagen</option>
                <option value="7">1 week</option>
                <option value="14">2 weken</option>
                <option value="28">4 weken</option>
                <option value="42">6 weken</option>
                <option value="56">8 weken</option>
                <option value="84">12 weken</option>
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
