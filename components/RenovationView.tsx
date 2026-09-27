"use client";

import { CalendarCheck, Check, Coins, Key, MagicWand, Plus, ShareNetwork, Sparkle, Truck, Warning, Wrench } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { aiRenovationPlan, type RenoProposal } from "@/lib/ai";
import { euroCents, FAL_COST } from "@/lib/fal";
import { newId } from "@/lib/rooms";
import {
  autoPlan,
  daysBetween,
  KINDS,
  lateTasks,
  PHASES,
  renovationOf,
  renovationText,
  renoTotals,
  suggestions,
  taskEnd,
  taskFromSuggestion,
  today,
  type Suggestion,
} from "@/lib/renovation";
import { euro, totals } from "@/lib/shopping";
import { addTasks, patchRenovation, replaceTasks } from "@/lib/tasks";
import type { Project, Task } from "@/lib/types";
import { useApp } from "./app";
import { I, RenoIcon } from "./icons";
import { TaskRow } from "./TaskRow";
import { BudgetBar, EuroInput } from "./ui";

type View = "volgorde" | "planning" | "kamers";

/** A new, empty job (the sheet opens on it; without a name it is dropped again). */
export function newTask(roomIds: string[] = []): Task {
  return { id: newId(), title: "", kind: "overig", roomIds, who: "vakman", status: "idee", quotes: [], beforeMove: true, note: "", addedAt: Date.now(), source: "zelf" };
}

export function RenovationView() {
  const { project, update, openTask, toast } = useApp();
  const r = renovationOf(project);
  const t = renoTotals(r.tasks);
  const late = lateTasks(r);
  const [view, setView] = useState<View>("volgorde");
  const lateIds = new Set(late.map((x) => x.id));
  const toKey = r.keyDate ? daysBetween(today(), r.keyDate) : undefined;
  const furnishing = totals(project.items).planned;

  function add(roomIds: string[] = []) {
    const task = newTask(roomIds);
    update(addTasks([task]));
    openTask(task.id);
  }

  async function share() {
    const text = renovationText(project);
    try {
      if (navigator.share) return void (await navigator.share({ title: "Verbouwplan", text }));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    await navigator.clipboard?.writeText(text);
    toast("Verbouwplan gekopieerd");
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Verbouwing</h1>
          <p className="lead">
            {r.tasks.length ? `${r.tasks.length} klussen · ${t.doneCount} klaar · ${euro(t.total)}` : "Alle klussen, offertes en de planning tot de verhuizing."}
          </p>
        </div>
        <div className="row">
          {r.tasks.length > 0 && (
            <button onClick={share}>
              <I icon={ShareNetwork} /> Delen
            </button>
          )}
          <button className="primary" onClick={() => add()}>
            <I icon={Plus} /> Klus
          </button>
        </div>
      </div>

      <div className="grid two" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="row" style={{ gap: 10 }}>
            <span className="icon-badge accent">
              <I icon={Key} size={20} />
            </span>
            <div>
              <h2 style={{ fontSize: 20 }}>Belangrijke data</h2>
              <p className="tiny muted">
                {toKey === undefined
                  ? "Vul de sleuteloverdracht in: dan plant de app alles vanaf die dag."
                  : toKey > 0
                    ? `Nog ${toKey} dagen tot de sleutel`
                    : toKey === 0
                      ? "Vandaag krijg je de sleutel!"
                      : r.moveDate && daysBetween(today(), r.moveDate) >= 0
                        ? `Nog ${daysBetween(today(), r.moveDate)} dagen tot de verhuizing`
                        : "De sleutel is binnen"}
              </p>
            </div>
          </div>
          <div className="field-row">
            <label className="field">
              Sleuteloverdracht
              <input type="date" value={r.keyDate ?? ""} onChange={(e) => update(patchRenovation({ keyDate: e.target.value || undefined }))} />
            </label>
            <label className="field">
              Verhuizing
              <input type="date" value={r.moveDate ?? ""} min={r.keyDate} onChange={(e) => update(patchRenovation({ moveDate: e.target.value || undefined }))} />
            </label>
          </div>
          {r.keyDate && r.moveDate && (
            <p className="small muted">
              {daysBetween(r.keyDate, r.moveDate)} dagen tussen sleutel en verhuizing
              {r.tasks.some((x) => x.beforeMove) ? ` voor ${r.tasks.filter((x) => x.beforeMove && x.status !== "klaar").length} klussen die vóór de verhuizing af moeten.` : "."}
            </p>
          )}
        </div>

        <div className="card stack">
          <div className="row" style={{ gap: 10 }}>
            <span className="icon-badge">
              <I icon={Coins} size={20} />
            </span>
            <div>
              <h2 style={{ fontSize: 20 }}>Kosten</h2>
              <p className="tiny muted">
                {t.firm ? `${euro(t.firm)} vast (gekozen offertes)` : "Nog geen offerte gekozen"}
                {t.estimated ? ` · ± ${euro(t.estimated)} geschat` : ""}
              </p>
            </div>
          </div>
          <label className="field">
            Budget voor de verbouwing
            <EuroInput value={r.budget} onChange={(budget) => update(patchRenovation({ budget }))} placeholder="bijv. 20000" />
          </label>
          <BudgetBar totals={{ planned: t.total, estimated: t.estimated, spent: t.done, count: t.count, bought: t.doneCount, unpriced: t.unpriced, must: 0 }} budget={r.budget} />
          <p className="small">
            Totaal nieuw huis: <strong className="num">{euro(t.total + furnishing)}</strong>{" "}
            <span className="muted">
              (verbouwing {euro(t.total)} + inrichting {euro(furnishing)})
              {r.budget || project.budget ? ` · budget ${euro((r.budget ?? 0) + (project.budget ?? 0))}` : ""}
            </span>
          </p>
        </div>
      </div>

      {late.length > 0 && (
        <div className="card warn-card stack tight" role="alert">
          <strong className="row" style={{ gap: 8 }}>
            <I icon={Warning} size={18} weight="bold" /> {late.length} {late.length === 1 ? "klus is" : "klussen zijn"} niet klaar vóór de verhuizing
          </strong>
          <span className="small">
            {late.map((x) => x.title).join(", ")}. Plan eerder, zet er een vakman op, of schuif de verhuizing op.
          </span>
        </div>
      )}

      <AiPlan />
      <Suggestions project={project} />

      {r.tasks.length > 0 ? (
        <div className="stack">
          <div className="row wrap-row between">
            <div className="segmented" role="tablist" aria-label="Weergave">
              {(
                [
                  ["volgorde", "Volgorde"],
                  ["planning", "Planning"],
                  ["kamers", "Per kamer"],
                ] as [View, string][]
              ).map(([v, label]) => (
                <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                  {label}
                </button>
              ))}
            </div>
            <button
              className="soft"
              onClick={() => {
                const before = project;
                update(replaceTasks(autoPlan(r.tasks, r.keyDate ?? today())));
                setView("planning");
                toast(r.keyDate ? "Ingepland vanaf de sleuteldatum" : "Ingepland vanaf vandaag (vul de sleuteldatum in)", () => update(() => before));
              }}
            >
              <I icon={MagicWand} /> Plan automatisch
            </button>
          </div>

          {view === "volgorde" &&
            PHASES.map((phase) => {
              const list = r.tasks.filter((x) => KINDS[x.kind].phase === phase.id);
              if (!list.length) return null;
              const pt = renoTotals(list);
              return (
                <div className="stack tight" key={phase.id}>
                  <div className="phase-head">
                    <span className={`phase-n${pt.doneCount === pt.count ? " done" : ""}`}>{pt.doneCount === pt.count ? <I icon={Check} size={14} weight="bold" /> : phase.id}</span>
                    <div className="grow">
                      <strong>{phase.label}</strong>
                      <p className="tiny muted">{phase.hint}</p>
                    </div>
                    <span className="small muted num nowrap">{euro(pt.total)}</span>
                  </div>
                  <div className="items">
                    {list.map((x) => (
                      <TaskRow key={x.id} task={x} late={lateIds.has(x.id)} />
                    ))}
                  </div>
                </div>
              );
            })}

          {view === "planning" && <Timeline tasks={r.tasks} keyDate={r.keyDate} moveDate={r.moveDate} lateIds={lateIds} />}

          {view === "kamers" &&
            [...project.rooms.map((room) => ({ key: room.id, name: room.name, list: r.tasks.filter((x) => x.roomIds.includes(room.id)) })), { key: "huis", name: "Hele huis", list: r.tasks.filter((x) => !x.roomIds.length) }]
              .filter((g) => g.list.length)
              .map((g) => (
                <div className="stack tight" key={g.key}>
                  <div className="group-head">
                    <span className="eyebrow">{g.name}</span>
                    <span className="small muted num">{euro(renoTotals(g.list).total)}</span>
                  </div>
                  <div className="items">
                    {g.list.map((x) => (
                      <TaskRow key={x.id} task={x} showRooms={false} late={lateIds.has(x.id)} />
                    ))}
                  </div>
                </div>
              ))}
        </div>
      ) : (
        <div className="empty">
          <span className="icon-badge accent">
            <I icon={Wrench} size={28} />
          </span>
          <strong>Nog geen klussen</strong>
          <span className="small">Kies hierboven wat vaak nodig is in dit huis, laat de AI een plan maken, of voeg zelf een klus toe.</span>
          <button className="accent" onClick={() => add()}>
            <I icon={Plus} /> Klus toevoegen
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** What usually comes up in this house, priced by the rooms' sizes: one tap puts it on the list. */
function Suggestions({ project, roomId, compact }: { project: Project; roomId?: string; compact?: boolean }) {
  const { update, toast } = useApp();
  const [all, setAll] = useState(false);
  const list = suggestions(project, roomId);
  if (!list.length) return null;
  const shown = all || compact ? list : list.slice(0, 6);
  const room = (s: Suggestion) => (s.roomId ? project.rooms.find((r) => r.id === s.roomId)?.name : "Hele huis");
  return (
    <div className={compact ? "stack tight" : "card stack"}>
      {!compact && (
        <div>
          <h2 style={{ fontSize: 20 }}>Vaak nodig in dit huis</h2>
          <p className="tiny muted">Richtprijzen op basis van de m² van je kamers, het bouwjaar en het energielabel.</p>
        </div>
      )}
      <div className="sugg-grid">
        {shown.map((s) => (
          <button
            key={s.key}
            className="sugg"
            onClick={() => {
              update(addTasks([taskFromSuggestion(s)]));
              toast(`${s.title} op de lijst`);
            }}
            title={s.why}
          >
            <span className="icon-badge">
              <RenoIcon kind={s.kind} size={18} />
            </span>
            <span className="grow">
              <strong>{s.title}</strong>
              <span className="tiny muted">
                {!compact && `${room(s)} · `}
                {s.who === "zelf" ? "zelf" : "vakman"} · ± {euro(s.estimate)}
              </span>
            </span>
            <I icon={Plus} size={18} />
          </button>
        ))}
      </div>
      {!compact && list.length > 6 && (
        <button className="ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? "Minder tonen" : `Alle ${list.length} tonen`}
        </button>
      )}
    </div>
  );
}
export { Suggestions as RenoSuggestions };

const lastPlan = new Map<string, RenoProposal[]>();

/** ✨ The AI looks at the photos, the description, build year and energy label. */
function AiPlan() {
  const { project, update, fal, toast } = useApp();
  const key = project.listing?.url ?? "";
  const [plan, setPlanState] = useState<RenoProposal[] | null>(() => lastPlan.get(key) ?? null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const have = new Set(renovationOf(project).tasks.map((x) => x.title.toLowerCase()));
  if (!fal || !project.listing) return null;

  const toTask = (p: RenoProposal): Task => ({
    id: newId(),
    title: p.title,
    kind: p.kind,
    roomIds: p.roomId ? [p.roomId] : [],
    who: p.who,
    status: "idee",
    estimate: p.estimate,
    quotes: [],
    days: p.days,
    beforeMove: p.beforeMove,
    note: "",
    why: p.why,
    addedAt: Date.now(),
    source: "ai",
  });

  async function run() {
    setError("");
    setBusy("Foto's bekijken…");
    try {
      const list = await aiRenovationPlan(project, (m) => m && setBusy(m.includes("bezig") ? `Foto's bekijken… ${m.match(/\d+ s/)?.[0] ?? ""}` : m));
      lastPlan.set(key, list);
      setPlanState(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const open = plan?.filter((p) => !have.has(p.title.toLowerCase())) ?? [];
  return (
    <div className="card ai-card stack">
      <div className="card-head">
        <div className="title" style={{ alignItems: "flex-start" }}>
          <span className="icon-badge accent">
            <I icon={Sparkle} size={20} />
          </span>
          <div className="stack tight" style={{ maxWidth: 560 }}>
            <h3>Verbouwplan van de AI</h3>
            <p className="small muted">De AI bekijkt de staat van vloeren, wanden, keuken en badkamer op de foto&apos;s, en leest bouwjaar, energielabel en omschrijving.</p>
          </div>
        </div>
        <button className="accent" onClick={run} disabled={!!busy}>
          {busy ? (
            <>
              <span className="spinner" /> {busy}
            </>
          ) : (
            <>
              <I icon={Sparkle} /> {plan ? "Opnieuw" : "Maak een plan"} <span className="cost">{euroCents(FAL_COST.renovation)}</span>
            </>
          )}
        </button>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <div className="stack tight">
          {plan.map((p) => {
            const added = have.has(p.title.toLowerCase());
            return (
              <div className="suggestion" key={p.title}>
                <span className="icon-badge">
                  <RenoIcon kind={p.kind} size={20} />
                </span>
                <div className="grow stack tight">
                  <strong className="small">{p.title}</strong>
                  <span className="tiny muted">
                    {p.roomId ? project.rooms.find((r) => r.id === p.roomId)?.name : "Hele huis"} · {p.who} {p.estimate ? `· ± ${euro(p.estimate)}` : ""} · {p.why}
                  </span>
                </div>
                <button className="small soft" disabled={added} onClick={() => update(addTasks([toTask(p)]))} aria-label={added ? `${p.title} staat op de lijst` : `${p.title} op de lijst zetten`}>
                  {added ? <I icon={Check} weight="bold" /> : <I icon={Plus} />}
                  {added ? "" : "Klus"}
                </button>
              </div>
            );
          })}
          {open.length > 1 && (
            <button
              className="small"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                update(addTasks(open.map(toTask)));
                toast(`${open.length} klussen op de lijst`);
              }}
            >
              <I icon={Plus} /> Alles toevoegen
            </button>
          )}
          <p className="tiny muted">Prijzen zijn schattingen; vraag offertes aan voor de echte prijs.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", opts);

/** Jobs as bars on a calendar from the key date to moving day; the dates are in the text too. */
function Timeline({ tasks, keyDate, moveDate, lateIds }: { tasks: Task[]; keyDate?: string; moveDate?: string; lateIds: Set<string> }) {
  const { openTask } = useApp();
  const planned = useMemo(() => tasks.filter((t) => t.start).sort((a, b) => a.start!.localeCompare(b.start!)), [tasks]);
  const unplanned = tasks.filter((t) => !t.start && t.status !== "klaar");
  if (!planned.length)
    return (
      <div className="empty">
        <span className="icon-badge accent">
          <I icon={CalendarCheck} size={28} />
        </span>
        <strong>Nog niets ingepland</strong>
        <span className="small">Tik op &quot;Plan automatisch&quot;: de app zet alles in de goede volgorde, vanaf de sleuteldatum.</span>
      </div>
    );
  const first = [keyDate, planned[0].start!].filter(Boolean).sort()[0]!;
  const last = [moveDate, ...planned.map((t) => taskEnd(t)!)].filter(Boolean).sort().at(-1)!;
  const span = Math.max(7, daysBetween(first, last) + 2);
  const x = (d: string) => `${(daysBetween(first, d) / span) * 100}%`;
  const w = (a: string, b: string) => `${Math.max(1.5, ((daysBetween(a, b) + 1) / span) * 100)}%`;
  // Week lines on Mondays.
  const weeks: string[] = [];
  for (let i = 0; i <= span; i++) {
    const d = new Date(new Date(`${first}T12:00:00Z`).getTime() + i * 86_400_000);
    if (d.getUTCDay() === 1) weeks.push(d.toISOString().slice(0, 10));
  }
  return (
    <div className="card stack">
      <div className="timeline" role="list">
        <div className="tl-scale" aria-hidden>
          {weeks.map((d) => (
            <span key={d} style={{ left: x(d) }}>
              {fmt(d, { day: "numeric", month: "short" })}
            </span>
          ))}
        </div>
        <div className="tl-body">
          {weeks.map((d) => (
            <span key={d} className="tl-week" style={{ left: x(d) }} aria-hidden />
          ))}
          {keyDate && (
            <span className="tl-mark key" style={{ left: x(keyDate) }} title={`Sleutel: ${fmt(keyDate, { day: "numeric", month: "long" })}`}>
              <I icon={Key} size={14} weight="bold" />
            </span>
          )}
          {moveDate && (
            <span className="tl-mark move" style={{ left: x(moveDate) }} title={`Verhuizing: ${fmt(moveDate, { day: "numeric", month: "long" })}`}>
              <I icon={Truck} size={14} weight="bold" />
            </span>
          )}
          {planned.map((t) => {
            const end = taskEnd(t)!;
            return (
              <button key={t.id} className="tl-row" role="listitem" onClick={() => openTask(t.id)} aria-label={`${t.title}: ${fmt(t.start!, { day: "numeric", month: "long" })} tot ${fmt(end, { day: "numeric", month: "long" })}`}>
                <span className="tl-label">
                  <strong>{t.title}</strong>
                  <span className="tiny muted">
                    {fmt(t.start!, { weekday: "short", day: "numeric", month: "short" })}
                    {end !== t.start ? ` – ${fmt(end, { weekday: "short", day: "numeric", month: "short" })}` : ""}
                  </span>
                </span>
                <span className="tl-track">
                  <span className={`tl-bar reno-${t.status}${lateIds.has(t.id) ? " late" : ""}`} style={{ left: x(t.start!), width: w(t.start!, end) }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="legend">
        <span>
          <i style={{ background: "var(--stone)" }} /> Idee / offertes
        </span>
        <span>
          <i style={{ background: "var(--info)" }} /> Gepland
        </span>
        <span>
          <i style={{ background: "var(--accent)" }} /> Bezig
        </span>
        <span>
          <i style={{ background: "var(--ok)" }} /> Klaar
        </span>
        <span>
          <i style={{ background: "var(--danger)" }} /> Na de verhuizing
        </span>
      </div>
      {unplanned.length > 0 && <p className="small muted">Nog niet ingepland: {unplanned.map((t) => t.title || "nieuwe klus").join(", ")}.</p>}
    </div>
  );
}
