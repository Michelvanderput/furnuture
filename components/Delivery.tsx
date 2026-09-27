"use client";

import { ArrowRight, CalendarCheck, Hammer, Key, Package, ShoppingCart, Truck, Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { addDays, deliveryIssue, deliveryPlan, expectedDelivery, leadLabel, orderAdvice, roomReady, shortDate, URGENT_DAYS } from "@/lib/delivery";
import { patchItem } from "@/lib/items";
import { daysBetween, KINDS, lateTasks, renovationOf, renoTotals, taskEnd, today } from "@/lib/renovation";
import { shortName } from "@/lib/shopping";
import { patchRenovation } from "@/lib/tasks";
import type { Item, Project } from "@/lib/types";
import { useApp } from "./app";
import { CategoryIcon, I, RenoIcon } from "./icons";
import { Img } from "./Img";

const roomName = (p: Project, id: string | null) => p.rooms.find((r) => r.id === id)?.name ?? "de kamer";

// ---------------------------------------------------------------------------
// In the product sheet

/** Delivery time, order date and expected delivery, with advice on when to order. */
export function DeliveryFields({ item }: { item: Item }) {
  const { project, update } = useApp();
  const set = (patch: Partial<Item>) => update(patchItem(item.id, patch));
  const [unit, setUnit] = useState<1 | 7>(item.leadDays && item.leadDays >= 14 && item.leadDays % 7 === 0 ? 7 : item.leadDays ? 1 : 7);
  const ordered = item.status === "besteld" || item.status === "binnen";
  const computed = item.orderedAt && item.leadDays !== undefined ? addDays(item.orderedAt, item.leadDays) : undefined;

  return (
    <div className="stack tight delivery">
      <div className="field-row">
        <div className="field">
          <label htmlFor={`lead-${item.id}`}>Levertijd</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              id={`lead-${item.id}`}
              inputMode="numeric"
              placeholder="?"
              style={{ width: 80 }}
              value={item.leadDays !== undefined ? Math.round((item.leadDays / unit) * 10) / 10 : ""}
              onChange={(e) => {
                const n = Number(e.target.value.replace(",", "."));
                set({ leadDays: e.target.value && n >= 0 ? Math.round(n * unit) : undefined });
              }}
            />
            <div className="segmented" role="group" aria-label="Eenheid">
              {([1, 7] as const).map((u) => (
                <button key={u} className={unit === u ? "on" : ""} aria-pressed={unit === u} onClick={() => setUnit(u)}>
                  {u === 1 ? "dagen" : "weken"}
                </button>
              ))}
            </div>
          </div>
          {item.leadText && <span className="tiny muted">Volgens {item.shop ?? "de winkel"}: {item.leadText}</span>}
        </div>
        {ordered && (
          <label className="field">
            Besteld op
            <input type="date" value={item.orderedAt ?? ""} onChange={(e) => set({ orderedAt: e.target.value || undefined })} />
          </label>
        )}
        {ordered && (
          <label className="field">
            {item.status === "binnen" ? "Geleverd op" : "Wordt geleverd op"}
            <input type="date" value={item.deliveryDate ?? computed ?? ""} onChange={(e) => set({ deliveryDate: e.target.value || undefined })} />
            {!item.deliveryDate && computed && <span className="tiny muted">berekend: besteldatum + levertijd</span>}
          </label>
        )}
      </div>
      <DeliveryAdvice item={item} />
    </div>
  );
}

function DeliveryAdvice({ item }: { item: Item }) {
  const { project } = useApp();
  const r = renovationOf(project);
  if (item.status === "binnen") return null;
  if (item.status === "besteld") {
    const date = expectedDelivery(item);
    if (!date) return <p className="tiny muted">Vul de levertijd of leverdatum in, dan komt het in de planning op het overzicht.</p>;
    const issue = deliveryIssue(project, item, date);
    const ready = roomReady(project, item.roomId).date;
    if (issue === "na-verhuizing") return <Advice bad>Komt {shortDate(date)}, na de verhuizing ({shortDate(r.moveDate!)}). Vraag of het eerder kan, of regel iets tijdelijks.</Advice>;
    if (issue === "voor-klaar")
      return <Advice warn>Komt {shortDate(date)}, maar {roomName(project, item.roomId)} is pas {shortDate(ready!)} klaar (verbouwing). Vraag of het later bezorgd kan worden, of zet het ergens anders neer.</Advice>;
    return <Advice ok>Komt {shortDate(date)}{r.moveDate ? `, op tijd voor de verhuizing` : ""}.</Advice>;
  }
  if (item.leadDays === undefined) return <p className="tiny muted">Weet je de levertijd? Dan zie je wanneer je uiterlijk moet bestellen.</p>;
  const a = orderAdvice(project, item);
  const parts: React.ReactNode[] = [];
  if (!r.moveDate) return <p className="tiny muted">Vul de verhuisdatum in (Verbouwing of Overzicht), dan zie je wanneer je uiterlijk moet bestellen.</p>;
  if (a.late) parts.push(`Bestel vandaag: ook dan komt het pas rond ${shortDate(addDays(today(), item.leadDays))}, na de verhuizing.`);
  else parts.push(`Bestel uiterlijk ${shortDate(a.latest!)} om het vóór de verhuizing (${shortDate(r.moveDate)}) in huis te hebben.`);
  if (a.earliest && a.ready) parts.push(` Liever niet vóór ${shortDate(a.earliest)}: ${roomName(project, item.roomId)} is pas ${shortDate(a.ready)} klaar.`);
  const soon = a.latest && daysBetween(today(), a.latest) <= URGENT_DAYS;
  return (
    <Advice bad={a.late} warn={!a.late && !!soon} ok={!a.late && !soon}>
      {parts}
    </Advice>
  );
}

function Advice({ children, ok, warn, bad }: { children: React.ReactNode; ok?: boolean; warn?: boolean; bad?: boolean }) {
  return (
    <p className={`advice small${bad ? " bad" : warn ? " warn" : ok ? " ok" : ""}`}>
      <I icon={bad || warn ? Warning : CalendarCheck} size={16} weight="bold" />
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// In lists

/** A small chip: when it arrives, or when to order it. */
export function DeliveryChip({ item }: { item: Item }) {
  const { project } = useApp();
  if (item.alternativeOf || item.status === "binnen") return null;
  if (item.status === "besteld") {
    const date = expectedDelivery(item);
    if (!date) return null;
    const issue = deliveryIssue(project, item, date);
    return (
      <span className={`chip ${issue === "na-verhuizing" ? "danger" : issue === "voor-klaar" ? "estimate" : ""}`} title={issue === "na-verhuizing" ? "Na de verhuizing" : issue === "voor-klaar" ? "Vóór de kamer klaar is" : "Verwachte levering"}>
        <I icon={Truck} size={13} /> {shortDate(date)}
      </span>
    );
  }
  if (item.leadDays === undefined) return null;
  const a = orderAdvice(project, item);
  if (a.late) return <span className="chip danger"><I icon={ShoppingCart} size={13} /> nu bestellen</span>;
  if (a.latest && daysBetween(today(), a.latest) <= 21)
    return (
      <span className={`chip ${daysBetween(today(), a.latest) <= URGENT_DAYS ? "danger" : "accent"}`}>
        <I icon={ShoppingCart} size={13} /> vóór {shortDate(a.latest)}
      </span>
    );
  return null;
}

// ---------------------------------------------------------------------------
// On the dashboard

/** Renovation and deliveries together: one timeline to moving day, and what needs doing now. */
export function PlanningCard() {
  const { project, update, openTask, openItem } = useApp();
  const r = renovationOf(project);
  const plan = deliveryPlan(project);
  const rt = renoTotals(r.tasks);
  const late = lateTasks(r);
  const next = r.tasks
    .filter((x) => x.status !== "klaar")
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999") || KINDS[a.kind].phase - KINDS[b.kind].phase)[0];
  const now = today();
  const toKey = r.keyDate ? daysBetween(now, r.keyDate) : undefined;
  const toMove = r.moveDate ? daysBetween(now, r.moveDate) : undefined;

  const orderNow = plan.toOrder.filter((o) => o.advice.late || (o.advice.latest && daysBetween(now, o.advice.latest) <= URGENT_DAYS));
  const issues = late.length + plan.incoming.filter((d) => d.issue).length + orderNow.length;
  const hasAnything = r.tasks.length || plan.toOrder.length || plan.incoming.length || plan.undated.length || r.keyDate || r.moveDate;

  return (
    <div className="card stack planning">
      <div className="section-head">
        <div className="row" style={{ gap: 10 }}>
          <span className="icon-badge accent">
            <I icon={CalendarCheck} size={20} />
          </span>
          <div>
            <h2 style={{ fontSize: 21 }}>Planning</h2>
            <p className="tiny muted">Verbouwing en leveringen tot de verhuisdag</p>
          </div>
        </div>
        {hasAnything ? (
          <span className={`chip ${issues ? "danger" : "ok"}`}>
            {issues ? (
              <>
                <I icon={Warning} size={13} weight="bold" /> {issues} aandachtspunt{issues > 1 ? "en" : ""}
              </>
            ) : (
              "Alles op schema"
            )}
          </span>
        ) : null}
      </div>

      <div className="countdowns">
        <DateBox icon={Key} label="Sleutel" date={r.keyDate} days={toKey} onChange={(keyDate) => update(patchRenovation({ keyDate }))} />
        <DateBox icon={Truck} label="Verhuizing" date={r.moveDate} days={toMove} min={r.keyDate} onChange={(moveDate) => update(patchRenovation({ moveDate }))} />
      </div>

      <PlanTimeline />

      <div className="plan-cols">
        <div className="stack tight">
          <span className="eyebrow">
            <I icon={Hammer} size={14} /> Verbouwing
          </span>
          {rt.count ? (
            <>
              <div className="bar" aria-label={`${rt.doneCount} van ${rt.count} klussen klaar`}>
                <span className="spent" style={{ width: `${(rt.doneCount / rt.count) * 100}%` }} />
              </div>
              <span className="tiny muted">
                {rt.doneCount} van {rt.count} klussen klaar
              </span>
              {next && (
                <button className="plan-line" onClick={() => openTask(next.id)}>
                  <span className="icon-badge small-badge">
                    <RenoIcon kind={next.kind} size={18} />
                  </span>
                  <span className="grow clip">{next.title}</span>
                  <span className="tiny muted nowrap">{next.start ? shortDate(next.start) : "nog plannen"}</span>
                </button>
              )}
              {late.length > 0 && (
                <span className="tiny error row" style={{ gap: 4 }}>
                  <I icon={Warning} size={14} weight="bold" /> {late.length} {late.length === 1 ? "klus is" : "klussen zijn"} niet klaar vóór de verhuizing
                </span>
              )}
            </>
          ) : (
            <a className="small" href="#/verbouwing">
              Klussen toevoegen <I icon={ArrowRight} size={12} />
            </a>
          )}
        </div>

        <div className="stack tight">
          <span className="eyebrow">
            <I icon={ShoppingCart} size={14} /> Bestellen
          </span>
          {plan.toOrder.slice(0, 4).map(({ item, advice }) => {
            const urgent = advice.late || (advice.latest && daysBetween(now, advice.latest) <= URGENT_DAYS);
            return (
              <button key={item.id} className="plan-line" onClick={() => openItem(item.id)}>
                <MiniThumb item={item} />
                <span className="grow clip">{shortName(item.title, 34)}</span>
                <span className={`tiny nowrap ${urgent ? "error strong" : "muted"}`}>
                  {advice.late ? "nu!" : advice.latest ? `vóór ${shortDate(advice.latest)}` : leadLabel(item.leadDays!)}
                </span>
              </button>
            );
          })}
          {plan.toOrder.length > 4 && <span className="tiny muted">en nog {plan.toOrder.length - 4}</span>}
          {plan.noLead.length > 0 && (
            <span className="tiny muted">
              {plan.noLead.length} gekozen product{plan.noLead.length > 1 ? "en" : ""} zonder levertijd
            </span>
          )}
          {!plan.toOrder.length && !plan.noLead.length && <span className="tiny muted">Niets om nu te bestellen.</span>}
        </div>

        <div className="stack tight">
          <span className="eyebrow">
            <I icon={Package} size={14} /> Leveringen
          </span>
          {plan.incoming.slice(0, 4).map(({ item, date, issue }) => (
            <button key={item.id} className="plan-line" onClick={() => openItem(item.id)}>
              <MiniThumb item={item} />
              <span className="grow clip">{shortName(item.title, 34)}</span>
              <span className={`tiny nowrap ${issue === "na-verhuizing" ? "error strong" : issue === "voor-klaar" ? "warn strong" : "muted"}`} title={issue === "voor-klaar" ? "Vóór de kamer klaar is" : issue ? "Na de verhuizing" : undefined}>
                {shortDate(date)}
              </span>
            </button>
          ))}
          {plan.incoming.length > 4 && <span className="tiny muted">en nog {plan.incoming.length - 4}</span>}
          {plan.undated.length > 0 && (
            <span className="tiny muted">
              {plan.undated.length} besteld zonder leverdatum
            </span>
          )}
          {!plan.incoming.length && !plan.undated.length && <span className="tiny muted">{plan.arrived ? `${plan.arrived} al in huis, niets onderweg.` : "Nog niets besteld."}</span>}
        </div>
      </div>
    </div>
  );
}

function DateBox({ icon, label, date, days, min, onChange }: { icon: typeof Key; label: string; date?: string; days?: number; min?: string; onChange: (d?: string) => void }) {
  return (
    <label className="countdown">
      <span className="icon-badge small-badge">
        <I icon={icon} size={18} />
      </span>
      <span className="stack" style={{ gap: 0 }}>
        <span className="tiny muted">{label}</span>
        <strong className="small">{days === undefined ? "datum?" : days > 1 ? `over ${days} dagen` : days === 1 ? "morgen" : days === 0 ? "vandaag" : shortDate(date!)}</strong>
      </span>
      <input type="date" aria-label={`Datum ${label.toLowerCase()}`} value={date ?? ""} min={min} onChange={(e) => onChange(e.target.value || undefined)} />
    </label>
  );
}

/** Weeks from now to moving day: jobs as bars, deliveries as dots, order-by days as rings. */
function PlanTimeline() {
  const { project, openTask, openItem } = useApp();
  const r = renovationOf(project);
  const plan = deliveryPlan(project);
  const now = today();
  const tasks = r.tasks.filter((t) => t.start).map((t) => ({ t, start: t.start!, end: taskEnd(t)! }));
  const deliveries = plan.incoming;
  const orders = plan.toOrder.filter((o) => o.advice.latest).map((o) => ({ item: o.item, date: o.advice.latest! < now ? now : o.advice.latest! }));
  const dates = [now, r.keyDate, r.moveDate, ...tasks.flatMap((x) => [x.start, x.end]), ...deliveries.map((d) => d.date), ...orders.map((o) => o.date)].filter((d): d is string => !!d).sort();
  if (dates.length < 2 && !tasks.length) return null;
  const from = addDays(dates[0], -2);
  let to = addDays(dates.at(-1)!, 3);
  if (daysBetween(from, to) < 28) to = addDays(from, 28);
  const span = daysBetween(from, to);
  const x = (d: string) => `${(daysBetween(from, d) / span) * 100}%`;
  const w = (a: string, b: string) => `${Math.max(((daysBetween(a, b) + 1) / span) * 100, 0.8)}%`;

  // Jobs side by side get their own line (at most three).
  const lines: string[] = [];
  const placed = tasks
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((x) => {
      let n = lines.findIndex((end) => end < x.start);
      if (n < 0) n = lines.length < 3 ? lines.push("") - 1 : lines.indexOf([...lines].sort()[0]);
      lines[n] = x.end;
      return { ...x, line: n };
    });

  // Deliveries on the same day become one dot.
  const byDay = new Map<string, typeof deliveries>();
  for (const d of deliveries) byDay.set(d.date, [...(byDay.get(d.date) ?? []), d]);

  const step = span > 120 ? 28 : span > 56 ? 14 : 7;
  const ticks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (parse(d).getUTCDay() === 1) ticks.push(d);
  const shown = ticks.filter((_, i) => i % (step / 7) === 0);

  return (
    <div className="plan-tl" role="group" aria-label="Planning tot de verhuizing">
      <div className="plan-lane">
        <span className="plan-label">Klussen</span>
        <div className="plan-track" style={{ height: Math.max(1, lines.length) * 12 + 8 }}>
          {shown.map((d) => (
            <i key={d} className="plan-grid" style={{ left: x(d) }} />
          ))}
          {placed.map(({ t, start, end, line }) => (
            <button
              key={t.id}
              className={`plan-bar reno-${t.status}${r.moveDate && t.beforeMove && end > r.moveDate && t.status !== "klaar" ? " late" : ""}`}
              style={{ left: x(start), width: w(start, end), top: 4 + line * 12 }}
              onClick={() => openTask(t.id)}
              title={`${t.title}: ${shortDate(start)} – ${shortDate(end)}`}
              aria-label={`${t.title}, ${shortDate(start)} tot ${shortDate(end)}`}
            />
          ))}
          <Markers x={x} keyDate={r.keyDate} moveDate={r.moveDate} now={now} />
        </div>
      </div>
      <div className="plan-lane">
        <span className="plan-label">Levering</span>
        <div className="plan-track">
          {shown.map((d) => (
            <i key={d} className="plan-grid" style={{ left: x(d) }} />
          ))}
          {[...byDay].map(([day, list]) => {
            const bad = list.some((d) => d.issue === "na-verhuizing");
            const warn = list.some((d) => d.issue === "voor-klaar");
            return (
              <button
                key={day}
                className={`plan-dot${bad ? " bad" : warn ? " warn" : ""}`}
                style={{ left: x(day) }}
                onClick={() => openItem(list[0].item.id)}
                title={`${shortDate(day)}: ${list.map((d) => d.item.title).join(", ")}`}
                aria-label={`${shortDate(day)}: ${list.map((d) => d.item.title).join(", ")}`}
              >
                {list.length > 1 ? list.length : ""}
              </button>
            );
          })}
          {orders.map(({ item, date }) => (
            <button key={item.id} className="plan-dot order" style={{ left: x(date) }} onClick={() => openItem(item.id)} title={`Uiterlijk ${shortDate(date)} bestellen: ${item.title}`} aria-label={`Uiterlijk ${shortDate(date)} bestellen: ${item.title}`} />
          ))}
          <Markers x={x} keyDate={r.keyDate} moveDate={r.moveDate} now={now} />
        </div>
      </div>
      <div className="plan-lane scale">
        <span className="plan-label" />
        <div className="plan-track">
          {shown.filter((d) => daysBetween(from, d) / span < 0.94).map((d) => (
            <span key={d} style={{ left: x(d) }}>
              {shortDate(d)}
            </span>
          ))}
        </div>
      </div>
      <div className="plan-legend tiny muted">
        <span>
          <i className="lg bar" /> klus
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

/** A product photo in a line (not a button: the line itself is one). */
function MiniThumb({ item }: { item: Item }) {
  const src = item.thumb ?? item.image;
  return <span className="plan-thumb">{src ? <Img src={src} width={64} alt="" loading="lazy" /> : <CategoryIcon category={item.category} size={16} />}</span>;
}

const parse = (s: string) => new Date(`${s}T12:00:00Z`);

function Markers({ x, keyDate, moveDate, now }: { x: (d: string) => string; keyDate?: string; moveDate?: string; now: string }) {
  return (
    <>
      <i className="plan-mark now" style={{ left: x(now) }} title="Vandaag" />
      {keyDate && <i className="plan-mark key" style={{ left: x(keyDate) }} title={`Sleutel ${shortDate(keyDate)}`} />}
      {moveDate && <i className="plan-mark move" style={{ left: x(moveDate) }} title={`Verhuizing ${shortDate(moveDate)}`} />}
    </>
  );
}
