"use client";

import { useState } from "react";
import { backupFileName, shareOrDownload } from "@/lib/backup";
import { CATEGORIES, CATEGORY_EMOJI } from "@/lib/categories";
import { patchItem } from "@/lib/items";
import { refreshPrice } from "@/lib/products";
import { byShop, euro, isBought, itemsIn, lineCost, mainItems, planCsv, planText, STATUS, totals } from "@/lib/shopping";
import { useApp } from "./app";
import { ItemRow } from "./ItemRow";
import { ShopLogo } from "./ui";

type View = "winkel" | "status" | "cijfers";

export function ShopView() {
  const { project, update, toast } = useApp();
  const [view, setView] = useState<View>("winkel");
  const [hideDone, setHideDone] = useState(true);
  const [checking, setChecking] = useState("");
  const items = mainItems(project.items).filter((i) => !hideDone || i.status !== "binnen");
  const t = totals(project.items);

  async function checkPrices() {
    const list = mainItems(project.items).filter((i) => i.url && !isBought(i));
    let changed = 0, cheaper = 0;
    for (const [n, i] of list.entries()) {
      setChecking(`${n + 1}/${list.length}`);
      try {
        const next = await refreshPrice(i);
        if (next) {
          changed++;
          if ((next.price ?? 0) < (i.price ?? 0)) cheaper++;
          update(patchItem(i.id, { price: next.price, priceHistory: next.priceHistory }));
        }
      } catch {
        // shop not reachable now: skip
      }
    }
    setChecking("");
    toast(changed ? `${changed} prijs${changed > 1 ? "zen" : ""} veranderd${cheaper ? `, ${cheaper}× goedkoper 🎉` : ""}` : "Alle prijzen zijn gelijk gebleven");
  }

  async function share() {
    const text = planText(project, true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Inkooplijst", text });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    await navigator.clipboard?.writeText(text);
    toast("Lijst gekopieerd: plak hem in WhatsApp of Notities");
  }

  return (
    <section className="page">
      <div className="section-head">
        <div className="stack tight">
          <h1>Winkelen</h1>
          <p className="muted small">
            {euro(t.planned - t.spent)} nog te kopen · {euro(t.spent)} besteld of in huis
          </p>
        </div>
        <div className="row wrap-row no-print">
          <button onClick={checkPrices} disabled={!!checking} title="Haal de actuele prijs op bij elke winkel">
            {checking ? (
              <>
                <span className="spinner" /> {checking}
              </>
            ) : (
              "↻ Prijzen checken"
            )}
          </button>
          <button onClick={share}>↗ Delen</button>
          <button onClick={() => shareOrDownload(new Blob([planCsv(project)], { type: "text/csv" }), backupFileName(project).replace(/\.json$/, ".csv"))}>⬇ Excel</button>
          <button onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      <div className="row wrap-row between no-print">
        <div className="segmented">
          <button className={view === "winkel" ? "on" : ""} onClick={() => setView("winkel")}>
            Per winkel
          </button>
          <button className={view === "status" ? "on" : ""} onClick={() => setView("status")}>
            Per status
          </button>
          <button className={view === "cijfers" ? "on" : ""} onClick={() => setView("cijfers")}>
            Cijfers
          </button>
        </div>
        {view !== "cijfers" && (
          <label className="row small muted" style={{ gap: 6 }}>
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} style={{ width: 18, minHeight: 0 }} />
            Verberg wat in huis is
          </label>
        )}
      </div>

      {items.length === 0 && view !== "cijfers" && (
        <div className="empty">
          <span className="big">🛍️</span>
          <strong>{hideDone && project.items.length ? "Alles staat in huis! 🎉" : "Nog niets op de lijst"}</strong>
        </div>
      )}

      {view === "winkel" &&
        byShop(items).map((g) => {
          const open = g.items.filter((i) => !isBought(i));
          return (
            <div className="shop-group card" key={g.shop}>
              <header>
                <ShopLogo url={g.items.find((i) => i.url)?.url} shop={g.shop} />
                <div className="grow">
                  <h3>{g.shop}</h3>
                  <span className="tiny muted">
                    {g.items.length} items · {euro(g.total)}
                  </span>
                </div>
                {open.length > 0 && g.shop !== "Nog te vinden" && (
                  <button
                    className="small soft no-print"
                    onClick={() => {
                      const before = project;
                      update((p) => ({ ...p, items: p.items.map((i) => (open.some((o) => o.id === i.id) ? { ...i, status: "besteld" } : i)) }));
                      toast(`📦 ${open.length} items bij ${g.shop} besteld`, () => update(() => before));
                    }}
                  >
                    📦 Alles besteld
                  </button>
                )}
              </header>
              <div className="items">
                {g.items.map((i) => (
                  <ItemRow key={i.id} item={i} showRoom check />
                ))}
              </div>
            </div>
          );
        })}

      {view === "status" &&
        STATUS.filter((s) => !hideDone || s.id !== "binnen").map((s) => {
          const list = items.filter((i) => i.status === s.id);
          if (!list.length) return null;
          return (
            <div className="stack" key={s.id}>
              <div className="row between">
                <h2>
                  {s.emoji} {s.label}
                </h2>
                <span className="num strong">{euro(totals(list).planned)}</span>
              </div>
              <div className="items">
                {list.map((i) => (
                  <ItemRow key={i.id} item={i} showRoom />
                ))}
              </div>
            </div>
          );
        })}

      {view === "cijfers" && <Figures />}
    </section>
  );
}

function Figures() {
  const { project } = useApp();
  const rows = [...project.rooms.map((r) => ({ name: r.name, budget: r.budget, t: totals(itemsIn(project.items, r.id)) })), { name: "Nog geen kamer", budget: undefined, t: totals(itemsIn(project.items, null)) }].filter(
    (r) => r.t.count || r.budget,
  );
  const all = totals(project.items);
  const cats = CATEGORIES.map((c) => ({ ...c, total: mainItems(project.items).filter((i) => i.category === c.id).reduce((n, i) => n + lineCost(i).value, 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...cats.map((c) => c.total));
  return (
    <>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Kamer</th>
              <th className="r">Items</th>
              <th className="r">Gepland</th>
              <th className="r">Besteld</th>
              <th className="r">Budget</th>
              <th className="r">Verschil</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="strong">{r.name}</td>
                <td className="r">{r.t.count}</td>
                <td className="r">{euro(r.t.planned)}</td>
                <td className="r">{euro(r.t.spent)}</td>
                <td className="r">{r.budget ? euro(r.budget) : "—"}</td>
                <td className="r">
                  {r.budget ? <span className={r.t.planned > r.budget ? "chip danger" : "chip ok"}>{euro(r.budget - r.t.planned)}</span> : ""}
                </td>
              </tr>
            ))}
            <tr>
              <td className="strong">Totaal</td>
              <td className="r strong">{all.count}</td>
              <td className="r strong">{euro(all.planned)}</td>
              <td className="r strong">{euro(all.spent)}</td>
              <td className="r strong">{project.budget ? euro(project.budget) : "—"}</td>
              <td className="r strong">{project.budget ? euro(project.budget - all.planned) : ""}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {cats.length > 0 && (
        <div className="card stack">
          <h3>Waar gaat het geld naartoe?</h3>
          {cats.map((c) => (
            <div key={c.id} className="stack tight">
              <div className="row between small">
                <span>
                  {CATEGORY_EMOJI[c.id]} {c.label}
                </span>
                <span className="num strong">
                  {euro(c.total)} <span className="muted tiny">({Math.round((c.total / Math.max(1, all.planned)) * 100)}%)</span>
                </span>
              </div>
              <div className="hbar" style={{ width: `${(c.total / max) * 100}%` }} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
