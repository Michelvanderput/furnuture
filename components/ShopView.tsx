"use client";

import { useState } from "react";
import { backupFileName, shareOrDownload } from "@/lib/backup";
import { ArrowsClockwise, DownloadSimple, Package, Printer, ShareNetwork, ShoppingBag } from "@phosphor-icons/react";
import { CATEGORIES } from "@/lib/categories";
import { patchItem, patchItems } from "@/lib/items";
import { refreshPrice } from "@/lib/products";
import { byShop, euro, isBought, isChosen, itemsIn, lineCost, mainItems, planCsv, planText, STATUS, totals } from "@/lib/shopping";
import { useApp } from "./app";
import { CategoryIcon, I, STATUS_ICON } from "./icons";
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
    toast(changed ? `${changed} prijs${changed > 1 ? "zen" : ""} veranderd${cheaper ? `, ${cheaper}× goedkoper` : ""}` : "Alle prijzen zijn gelijk gebleven");
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
      <div className="page-head">
        <div>
          <h1>Winkelen</h1>
          <p className="lead">
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
              <>
                <I icon={ArrowsClockwise} /> Prijzen checken
              </>
            )}
          </button>
          <button onClick={share}>
            <I icon={ShareNetwork} /> Delen
          </button>
          <button onClick={() => shareOrDownload(new Blob([planCsv(project)], { type: "text/csv" }), backupFileName(project).replace(/\.json$/, ".csv"))}>
            <I icon={DownloadSimple} /> Excel
          </button>
          <button className="icon" onClick={() => window.print()} aria-label="Printen" title="Printen">
            <I icon={Printer} />
          </button>
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
          <span className="icon-badge accent">
            <I icon={ShoppingBag} size={28} />
          </span>
          <strong>{hideDone && project.items.length ? "Alles staat in huis!" : "Nog niets op de lijst"}</strong>
        </div>
      )}

      {view === "winkel" &&
        byShop(items).map((g) => {
          const open = g.items.filter((i) => !isBought(i));
          return (
            <div className="stack" key={g.shop}>
              <div className="row">
                <ShopLogo url={g.items.find((i) => i.url)?.url} shop={g.shop} />
                <div className="grow">
                  <h2 style={{ fontSize: 21 }}>{g.shop}</h2>
                  <span className="small muted">
                    {g.items.length} {g.items.length === 1 ? "item" : "items"} · {euro(g.total)}
                  </span>
                </div>
                {open.length > 0 && g.shop !== "Nog te vinden" && (
                  <button
                    className="small soft no-print"
                    onClick={() => {
                      const before = project;
                      update(patchItems(open.map((o) => o.id), { status: "besteld" }));
                      toast(`${open.length} items bij ${g.shop} besteld`, () => update(() => before));
                    }}
                  >
                    <I icon={Package} /> Alles besteld
                  </button>
                )}
              </div>
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
                <h2 className="row" style={{ gap: 10 }}>
                  <I icon={STATUS_ICON[s.id]} size={22} /> {s.label}
                </h2>
                <span className="num strong">{euro(s.id === "idee" ? totals(list).ideas : totals(list).planned)}</span>
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
  const cats = CATEGORIES.map((c) => ({ ...c, total: mainItems(project.items).filter((i) => i.category === c.id && isChosen(i)).reduce((n, i) => n + lineCost(i).value, 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...cats.map((c) => c.total));
  return (
    <>
      <div className="card">
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Kamer</th>
              <th className="r">Items</th>
              <th className="r">Gekozen</th>
              <th className="r">Ideeën</th>
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
                <td className="r muted">{r.t.ideas ? euro(r.t.ideas) : "—"}</td>
                <td className="r">{euro(r.t.spent)}</td>
                <td className="r">{r.budget ? euro(r.budget) : "—"}</td>
                <td className="r">
                  {r.budget ? <span className={r.t.planned > r.budget ? "chip danger" : "chip ok"}>{euro(r.budget - r.t.planned)}</span> : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Totaal</td>
              <td className="r">{all.count}</td>
              <td className="r">{euro(all.planned)}</td>
              <td className="r">{all.ideas ? euro(all.ideas) : "—"}</td>
              <td className="r">{euro(all.spent)}</td>
              <td className="r">{project.budget ? euro(project.budget) : "—"}</td>
              <td className="r">{project.budget ? euro(project.budget - all.planned) : ""}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
      {cats.length > 0 && (
        <div className="card stack">
          <h2>Waar gaat het geld naartoe?</h2>
          {cats.map((c) => (
            <div key={c.id} className="stack tight">
              <div className="row between small">
                <span className="row" style={{ gap: 8 }}>
                  <CategoryIcon category={c.id} size={16} /> {c.label}
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
