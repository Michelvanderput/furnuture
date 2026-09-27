"use client";

import { patchItem } from "@/lib/items";
import { priceChange } from "@/lib/products";
import { ROOM_EMOJI, roomPhotos } from "@/lib/rooms";
import { href } from "@/lib/route";
import { euro, isBought, itemsIn, lineCost, mainItems, suggestSplit, totals } from "@/lib/shopping";
import type { Project } from "@/lib/types";
import { useApp } from "./app";
import { HouseHero } from "./HouseView";
import { Img } from "./Img";
import { ItemRow } from "./ItemRow";
import { BudgetBar, EuroInput, Ring } from "./ui";

export function Dashboard() {
  const { project, update, toast } = useApp();
  const t = totals(project.items);
  const budget = project.budget;
  const left = budget ? budget - t.planned : undefined;
  const drops = mainItems(project.items).filter((i) => (priceChange(i) ?? 0) < 0);
  const loose = mainItems(itemsIn(project.items, null));
  const biggest = [...mainItems(project.items)].filter((i) => !isBought(i)).sort((a, b) => lineCost(b).value - lineCost(a).value).slice(0, 5);

  return (
    <section className="page">
      <HouseHero />

      <div className="grid stats">
        <div className="stat">
          <span className="label">Totaal gepland</span>
          <span className="value">{euro(t.planned)}</span>
          <span className="tiny muted">{t.estimated ? `waarvan ± ${euro(t.estimated)} geschat` : `${t.count} items`}</span>
        </div>
        <div className="stat">
          <span className="label">{left === undefined ? "Budget" : left >= 0 ? "Nog te besteden" : "Boven budget"}</span>
          <span className="value" style={{ color: left !== undefined && left < 0 ? "var(--danger)" : undefined }}>
            {left === undefined ? "—" : euro(Math.abs(left))}
          </span>
          <span className="tiny muted">{budget ? `van ${euro(budget)}` : "stel hieronder in"}</span>
        </div>
        <div className="stat">
          <span className="label">Besteld & in huis</span>
          <span className="value">{euro(t.spent)}</span>
          <span className="tiny muted">
            {t.bought} van {t.count} items
          </span>
        </div>
        <div className="stat">
          <span className="label">Must-haves</span>
          <span className="value">{euro(t.must)}</span>
          <span className="tiny muted">het minimum om te verhuizen</span>
        </div>
      </div>

      <NextSteps project={project} />

      <div className="grid two">
        <div className="card stack">
          <div className="row" style={{ gap: 20 }}>
            <Ring pct={budget ? (t.planned / budget) * 100 : t.count ? (t.spent / Math.max(1, t.planned)) * 100 : 0} over={!!budget && t.planned > budget}>
              <div className="big num">{budget ? Math.round((t.planned / budget) * 100) : Math.round((t.spent / Math.max(1, t.planned)) * 100)}%</div>
              <div className="tiny muted">{budget ? "van budget" : "gekocht"}</div>
            </Ring>
            <div className="stack grow">
              <label className="field">
                Totaalbudget inrichting
                <EuroInput value={budget} onChange={(b) => update((p) => ({ ...p, budget: b }))} placeholder="bijv. 15000" />
              </label>
              {budget && project.rooms.length > 0 && (
                <button
                  className="small soft"
                  onClick={() => {
                    if (project.rooms.some((r) => r.budget) && !confirm("Het budget per kamer opnieuw verdelen? Wat je per kamer had ingesteld, wordt overschreven.")) return;
                    const split = suggestSplit(budget, project.rooms);
                    const before = project;
                    update((p) => ({ ...p, rooms: p.rooms.map((r) => ({ ...r, budget: split[r.id] })) }));
                    toast("Budget verdeeld over de kamers", () => update(() => before));
                  }}
                >
                  ⚖︎ Verdeel slim over de kamers
                </button>
              )}
            </div>
          </div>
          <BudgetBar totals={t} budget={budget} />
          <div className="legend">
            <span>
              <i style={{ background: "var(--accent)" }} />
              Besteld/in huis
            </span>
            <span>
              <i style={{ background: "color-mix(in srgb, var(--accent) 35%, transparent)" }} />
              Gekozen/idee
            </span>
            <span>
              <i style={{ background: "color-mix(in srgb, var(--warm) 45%, transparent)" }} />
              Geschat
            </span>
          </div>
        </div>

        <div className="card stack tight">
          <div className="row between">
            <h3>Per kamer</h3>
            <a className="small" href="#/kamers">
              Alle kamers →
            </a>
          </div>
          {project.rooms.map((r) => {
            const rt = totals(itemsIn(project.items, r.id));
            const photo = roomPhotos(project.listing, r.id)[0];
            return (
              <a key={r.id} className="room-mini" href={href({ view: "kamer", id: r.id })}>
                <span className="thumb">{photo ? <Img src={photo.url} width={160} alt="" loading="lazy" /> : ROOM_EMOJI[r.type]}</span>
                <span className="grow stack tight">
                  <span className="row between">
                    <strong className="clip">{r.name}</strong>
                    <span className="num strong">{euro(rt.planned)}</span>
                  </span>
                  <BudgetBar totals={rt} budget={r.budget} />
                  <span className="tiny muted">
                    {rt.count ? `${rt.bought}/${rt.count} gekocht` : "nog leeg"}
                    {r.budget ? ` · budget ${euro(r.budget)}` : ""}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </div>

      {(drops.length > 0 || loose.length > 0) && (
        <div className="grid two">
          {drops.length > 0 && (
            <div className="card stack">
              <h3>📉 Prijs gedaald</h3>
              <div className="items">
                {drops.map((i) => (
                  <ItemRow key={i.id} item={i} showRoom />
                ))}
              </div>
            </div>
          )}
          {loose.length > 0 && (
            <div className="card stack">
              <div className="row between">
                <h3>📥 Nog geen kamer</h3>
                <span className="tiny muted">Tik op een item om een kamer te kiezen</span>
              </div>
              <div className="items">
                {loose.slice(0, 6).map((i) => (
                  <div key={i.id} className="row">
                    <div className="grow">
                      <ItemRow item={i} />
                    </div>
                    <select
                      aria-label="Kamer"
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
        <div className="card stack">
          <div className="row between">
            <h3>💶 Grootste uitgaven nog te doen</h3>
            <a className="small" href="#/winkelen">
              Naar winkelen →
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
    { done: project.rooms.some((r) => r.area || r.floor), label: "Kamers controleren", hint: fal ? "✨ laat de AI ze herkennen" : "namen, m² en foto's", href: "#/woning" },
    { done: project.budget !== undefined, label: "Budget instellen", hint: "hieronder", href: undefined },
    { done: project.items.length > 0, label: "Eerste product toevoegen", hint: "plak een webshoplink", action: () => openAdd({ roomId: project.rooms[0]?.id ?? null }) },
    { done: project.items.some((i) => i.status !== "idee"), label: "Iets kiezen of bestellen", hint: "tik op de status van een item", href: undefined },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="card tint stack tight">
      <strong>Aan de slag</strong>
      <div className="row wrap-row">
        {steps.map((s, n) => (
          <a
            key={s.label}
            className={`chip ${s.done ? "ok" : ""}`}
            href={s.href}
            onClick={s.action ? (e) => (e.preventDefault(), s.action!()) : undefined}
            style={{ padding: "6px 12px", cursor: s.href || s.action ? "pointer" : undefined }}
          >
            {s.done ? "✓" : `${n + 1}.`} {s.label}
            {!s.done && <span className="muted" style={{ fontWeight: 500 }}> · {s.hint}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}
