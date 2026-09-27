"use client";

import { ArrowRight, Check, CheckCircle, Couch, Hammer, Scales, TrendDown, Tray, Wallet, Warning } from "@phosphor-icons/react";
import { daysBetween, KINDS, lateTasks, renovationOf, renoTotals, today } from "@/lib/renovation";
import { patchItem } from "@/lib/items";
import { priceChange } from "@/lib/products";
import { roomPhotos } from "@/lib/rooms";
import { href } from "@/lib/route";
import { euro, isBought, itemsIn, lineCost, mainItems, suggestSplit, totals } from "@/lib/shopping";
import type { Project } from "@/lib/types";
import { useApp } from "./app";
import { HouseHero } from "./HouseView";
import { I, RenoIcon, RoomIcon } from "./icons";
import { Img } from "./Img";
import { ItemRow } from "./ItemRow";
import { RoomDetect, roomsRecognised } from "./RoomDetect";
import { BudgetBar, EuroInput, Ring } from "./ui";

export function Dashboard() {
  const { project, update, toast } = useApp();
  const t = totals(project.items);
  const rt = renoTotals(renovationOf(project).tasks);
  const budget = project.budget;
  const allBudget = (budget ?? 0) + (renovationOf(project).budget ?? 0);
  const left = allBudget ? allBudget - t.planned - rt.total : undefined;
  const drops = mainItems(project.items).filter((i) => (priceChange(i) ?? 0) < 0);
  const loose = mainItems(itemsIn(project.items, null));
  const biggest = [...mainItems(project.items)]
    .filter((i) => !isBought(i))
    .sort((a, b) => lineCost(b).value - lineCost(a).value)
    .slice(0, 5);
  const pct = budget ? (t.planned / budget) * 100 : t.planned ? (t.spent / t.planned) * 100 : 0;

  return (
    <section className="page">
      <HouseHero />

      {/* What to do next comes first; the figures follow once there is something to count. */}
      <RoomDetect compact />
      <NextSteps project={project} />

      <div className="grid stats">
        <div className="stat">
          <span className="label">
            <I icon={Couch} size={16} /> Inrichting
          </span>
          <span className="value">{euro(t.planned)}</span>
          <span className="sub">{t.estimated ? `waarvan ± ${euro(t.estimated)} geschat` : `${t.count} items`}</span>
        </div>
        <div className="stat">
          <span className="label">
            <I icon={Hammer} size={16} /> Verbouwing
          </span>
          <span className="value">{euro(rt.total)}</span>
          <span className="sub">{rt.count ? `${rt.doneCount} van ${rt.count} klussen klaar` : "nog geen klussen"}</span>
        </div>
        <div className="stat">
          <span className="label">
            <I icon={CheckCircle} size={16} /> Besteld & klaar
          </span>
          <span className="value">{euro(t.spent + rt.done)}</span>
          <span className="sub">
            {t.bought} items, {rt.doneCount} klussen
          </span>
        </div>
        <div className="stat">
          <span className="label">
            <I icon={Wallet} size={16} /> {left === undefined ? "Budget" : left >= 0 ? "Nog te besteden" : "Boven budget"}
          </span>
          <span className={`value${left !== undefined && left < 0 ? " bad" : ""}`}>{left === undefined ? "—" : euro(Math.abs(left))}</span>
          <span className="sub">{allBudget ? `van ${euro(allBudget)} voor inrichting en verbouwing` : "nog niet ingesteld"}</span>
        </div>
      </div>

      <RenovationCard />

      <div className="grid two" style={{ alignItems: "start" }}>
        <div className="card stack" style={{ gap: 20 }}>
          <h2>Budget</h2>
          <div className="row wrap-row" style={{ gap: 24 }}>
            <Ring pct={pct} over={!!budget && t.planned > budget}>
              <div className="big">{Math.round(pct)}%</div>
              <div className="tiny muted">{budget ? "van budget" : "gekocht"}</div>
            </Ring>
            <div className="stack grow" style={{ minWidth: 200 }}>
              <label className="field">
                Totaalbudget voor de inrichting
                <EuroInput value={budget} onChange={(b) => update((p) => ({ ...p, budget: b }))} placeholder="bijv. 15000" />
              </label>
              {budget && project.rooms.length > 0 && (
                <button
                  className="soft"
                  onClick={() => {
                    if (project.rooms.some((r) => r.budget) && !confirm("Het budget per kamer opnieuw verdelen? Wat je per kamer had ingesteld, wordt overschreven.")) return;
                    const split = suggestSplit(budget, project.rooms);
                    const before = project;
                    update((p) => ({ ...p, rooms: p.rooms.map((r) => ({ ...r, budget: split[r.id] })) }));
                    toast("Budget verdeeld over de kamers", () => update(() => before));
                  }}
                >
                  <I icon={Scales} /> Verdeel over de kamers
                </button>
              )}
            </div>
          </div>
          <BudgetBar totals={t} budget={budget} />
          <div className="legend">
            <span>
              <i style={{ background: "var(--ok)" }} />
              Besteld of in huis
            </span>
            <span>
              <i style={{ background: "var(--stone)" }} />
              Gekozen of idee
            </span>
            <span>
              <i style={{ background: "var(--accent)" }} />
              Geschat
            </span>
          </div>
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h2>Per kamer</h2>
            <a className="small strong row" style={{ gap: 4 }} href="#/kamers">
              Alle kamers <I icon={ArrowRight} size={14} />
            </a>
          </div>
          {project.rooms.map((r) => {
            const rt = totals(itemsIn(project.items, r.id));
            const photo = roomPhotos(project.listing, r.id)[0];
            return (
              <a key={r.id} className="room-row" href={href({ view: "kamer", id: r.id })}>
                <span className="thumb">{photo ? <Img src={photo.url} width={160} alt="" loading="lazy" /> : <RoomIcon type={r.type} size={22} />}</span>
                <span className="grow stack" style={{ gap: 6 }}>
                  <span className="row between">
                    <strong className="clip">{r.name}</strong>
                    <span className="num strong">{euro(rt.planned)}</span>
                  </span>
                  <BudgetBar totals={rt} budget={r.budget} />
                  <span className="tiny muted">
                    {rt.count ? `${rt.bought} van ${rt.count} gekocht` : "nog leeg"}
                    {r.budget ? ` · budget ${euro(r.budget)}` : ""}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </div>

      {(drops.length > 0 || loose.length > 0) && (
        <div className="grid two" style={{ alignItems: "start" }}>
          {drops.length > 0 && (
            <div className="stack">
              <div className="row" style={{ gap: 10 }}>
                <span className="icon-badge" style={{ color: "var(--ok)" }}>
                  <I icon={TrendDown} size={20} />
                </span>
                <h2>Prijs gedaald</h2>
              </div>
              <div className="items">
                {drops.map((i) => (
                  <ItemRow key={i.id} item={i} showRoom />
                ))}
              </div>
            </div>
          )}
          {loose.length > 0 && (
            <div className="stack">
              <div className="row" style={{ gap: 10 }}>
                <span className="icon-badge">
                  <I icon={Tray} size={20} />
                </span>
                <div>
                  <h2>Nog geen kamer</h2>
                  <p className="tiny muted">Kies rechts de kamer</p>
                </div>
              </div>
              <div className="items">
                {loose.slice(0, 6).map((i) => (
                  <div key={i.id} className="row" style={{ gap: 0, paddingRight: 12 }}>
                    <div className="grow">
                      <ItemRow item={i} />
                    </div>
                    <select
                      aria-label={`Kamer voor ${i.title}`}
                      style={{ width: 130 }}
                      value=""
                      onChange={(e) => e.target.value && update(patchItem(i.id, { roomId: e.target.value }))}
                    >
                      <option value="">Naar…</option>
                      {project.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {biggest.length > 0 && (
        <div className="stack">
          <div className="section-head">
            <h2>Grootste uitgaven nog te doen</h2>
            <a className="small strong row" style={{ gap: 4 }} href="#/winkelen">
              Naar winkelen <I icon={ArrowRight} size={14} />
            </a>
          </div>
          <div className="items">
            {biggest.map((i) => (
              <ItemRow key={i.id} item={i} showRoom />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** A short to-do for a fresh project; disappears when everything is done. */
function NextSteps({ project }: { project: Project }) {
  const { openAdd, fal } = useApp();
  const steps = [
    { done: roomsRecognised(project.rooms), label: "Kamers controleren", hint: fal ? "laat de AI ze herkennen" : "namen, m² en foto's", href: "#/woning" },
    { done: project.budget !== undefined, label: "Budget instellen", hint: "hieronder" },
    { done: project.items.length > 0, label: "Eerste product toevoegen", hint: "plak een webshoplink", action: () => openAdd({ roomId: project.rooms[0]?.id ?? null }) },
    { done: project.items.some((i) => i.status !== "idee"), label: "Iets kiezen of bestellen", hint: "tik op de status" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="stack">
      <h2>Aan de slag</h2>
      <div className="steps">
        {steps.map((s, n) => {
          const inner = (
            <>
              <span className="n">{s.done ? <I icon={Check} size={13} weight="bold" /> : n + 1}</span>
              <span>
                {s.label}
                {!s.done && <span className="hint"> · {s.hint}</span>}
              </span>
            </>
          );
          if (s.action && !s.done)
            return (
              <button key={s.label} className="step" onClick={s.action}>
                {inner}
              </button>
            );
          return s.href && !s.done ? (
            <a key={s.label} className="step" href={s.href}>
              {inner}
            </a>
          ) : (
            <span key={s.label} className={`step${s.done ? " done" : ""}`} style={{ cursor: "default" }}>
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Renovation at a glance: days to the key, what is next, and what will not be ready in time. */
function RenovationCard() {
  const { project, openTask } = useApp();
  const r = renovationOf(project);
  if (!r.tasks.length && !r.keyDate) return null;
  const rt = renoTotals(r.tasks);
  const late = lateTasks(r);
  const next = r.tasks
    .filter((x) => x.status !== "klaar")
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999") || KINDS[a.kind].phase - KINDS[b.kind].phase)[0];
  const toKey = r.keyDate ? daysBetween(today(), r.keyDate) : undefined;
  const toMove = r.moveDate ? daysBetween(today(), r.moveDate) : undefined;
  return (
    <div className="card stack">
      <div className="section-head">
        <div className="row" style={{ gap: 10 }}>
          <span className="icon-badge accent">
            <I icon={Hammer} size={20} />
          </span>
          <div>
            <h2 style={{ fontSize: 21 }}>Verbouwing</h2>
            <p className="tiny muted">
              {toKey !== undefined && toKey > 0 ? `Nog ${toKey} dagen tot de sleutel` : toMove !== undefined && toMove >= 0 ? `Nog ${toMove} dagen tot de verhuizing` : `${rt.doneCount} van ${rt.count} klussen klaar`}
            </p>
          </div>
        </div>
        <a className="small strong row" style={{ gap: 4 }} href="#/verbouwing">
          Naar de verbouwing <I icon={ArrowRight} size={14} />
        </a>
      </div>
      {rt.count > 0 && (
        <div className="bar" aria-label={`${rt.doneCount} van ${rt.count} klussen klaar`}>
          <span className="spent" style={{ width: `${(rt.doneCount / rt.count) * 100}%` }} />
        </div>
      )}
      {next && (
        <button className="suggestion next-task" onClick={() => openTask(next.id)}>
          <span className="icon-badge">
            <RenoIcon kind={next.kind} size={20} />
          </span>
          <span className="grow stack tight" style={{ textAlign: "left" }}>
            <span className="tiny muted">Eerstvolgende klus</span>
            <strong className="small">{next.title}</strong>
          </span>
          <span className="small muted nowrap">{next.start ? new Date(`${next.start}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "nog plannen"}</span>
        </button>
      )}
      {late.length > 0 && (
        <p className="small error row" style={{ gap: 6 }}>
          <I icon={Warning} size={16} weight="bold" /> {late.length} {late.length === 1 ? "klus is" : "klussen zijn"} niet klaar vóór de verhuizing
        </p>
      )}
    </div>
  );
}
