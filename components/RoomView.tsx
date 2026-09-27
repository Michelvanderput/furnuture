"use client";

import { useMemo, useState } from "react";
import { aiAdvice, aiStyle, type Advice, type StyleCheck } from "@/lib/ai";
import { CATEGORIES, CATEGORY_EMOJI } from "@/lib/categories";
import { euroCents, FAL_COST } from "@/lib/fal";
import { addItems, patchRoom, removeRoom } from "@/lib/items";
import { FURNISHABLE, newId, ROOM_EMOJI, roomPhotos } from "@/lib/rooms";
import { go } from "@/lib/route";
import { alternativesOf, euro, isBought, itemsIn, lineCost, mainItems, totals } from "@/lib/shopping";
import type { Item, Room, RoomType } from "@/lib/types";
import { roomLabel } from "@/lib/categories";
import { useApp } from "./app";
import { Img } from "./Img";
import { ItemRow } from "./ItemRow";
import { BudgetBar, EuroInput, Lightbox, Sheet } from "./ui";

type Filter = "alles" | "kopen" | "gekocht" | "must";

export function RoomView({ roomId }: { roomId: string }) {
  const { project, openAdd, fal } = useApp();
  const room = project.rooms.find((r) => r.id === roomId)!;
  const photos = roomPhotos(project.listing, room.id);
  const all = itemsIn(project.items, room.id);
  const t = totals(all);
  const [filter, setFilter] = useState<Filter>("alles");
  const [sort, setSort] = useState<"soort" | "prijs" | "nieuw">("soort");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  const list = useMemo(() => {
    const main = mainItems(all).filter((i) =>
      filter === "kopen" ? !isBought(i) : filter === "gekocht" ? isBought(i) : filter === "must" ? i.must : true,
    );
    if (sort === "prijs") return [...main].sort((a, b) => lineCost(b).value - lineCost(a).value);
    if (sort === "nieuw") return [...main].sort((a, b) => b.addedAt - a.addedAt);
    return main;
  }, [all, filter, sort]);

  const groups = useMemo(() => {
    if (sort !== "soort") return [{ key: "all", label: "", items: list }];
    return CATEGORIES.map((c) => ({ key: c.id, label: `${CATEGORY_EMOJI[c.id]} ${c.label}`, items: list.filter((i) => i.category === c.id) })).filter((g) => g.items.length);
  }, [list, sort]);

  const over = !!room.budget && t.planned > room.budget;

  return (
    <section className="page">
      <div className="stack tight">
        <a href="#/kamers" className="small">
          ← Alle kamers
        </a>
        <div className="section-head">
          <div className="stack tight">
            <h1>
              {ROOM_EMOJI[room.type]} {room.name}
            </h1>
            <div className="row wrap-row small muted">
              {room.floor && <span>{room.floor}</span>}
              {room.area && <span>· {room.area} m²</span>}
              <span>
                · {t.count} {t.count === 1 ? "item" : "items"}
              </span>
              {room.note && <span>· {room.note}</span>}
            </div>
          </div>
          <button onClick={() => setEditing(true)}>✎ Kamer bewerken</button>
        </div>
      </div>

      {photos.length > 0 && (
        <div className="gallery">
          {photos.map((p, i) => (
            <Img key={p.id} src={p.url} width={640} alt={room.name} loading="lazy" onClick={() => setLightbox(i)} />
          ))}
        </div>
      )}

      <div className="card stack">
        <div className="row between wrap-row">
          <div className="stack tight">
            <span className="eyebrow">Totaal voor deze kamer</span>
            <span className="row" style={{ alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }} className="num">
                {euro(t.planned)}
              </span>
              {room.budget ? (
                <span className={over ? "error strong" : "muted"}>
                  van {euro(room.budget)} {over ? `· ${euro(t.planned - room.budget)} te veel` : `· ${euro(room.budget - t.planned)} over`}
                </span>
              ) : (
                <button className="ghost small" onClick={() => setEditing(true)}>
                  ＋ Budget instellen
                </button>
              )}
            </span>
          </div>
          <div className="row wrap-row">
            {t.spent > 0 && <span className="chip ok">✓ {euro(t.spent)} besteld/in huis</span>}
            {t.estimated > 0 && <span className="chip warm">± {euro(t.estimated)} geschat</span>}
            {t.unpriced > 0 && <span className="chip">{t.unpriced} zonder prijs</span>}
          </div>
        </div>
        <BudgetBar totals={t} budget={room.budget} />
      </div>

      <AiCard room={room} />

      <div className="stack">
        <div className="section-head">
          <div className="filters">
            {(
              [
                ["alles", "Alles"],
                ["kopen", "Nog kopen"],
                ["gekocht", "Besteld & in huis"],
                ["must", "★ Must-haves"],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
          <div className="row">
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: "auto", minHeight: 36 }} aria-label="Sorteren">
              <option value="soort">Per soort</option>
              <option value="prijs">Duurste eerst</option>
              <option value="nieuw">Nieuwste eerst</option>
            </select>
            <button className="primary" onClick={() => openAdd({ roomId: room.id })}>
              ＋ Toevoegen
            </button>
          </div>
        </div>

        {all.length === 0 ? (
          <div className="empty">
            <span className="big">{ROOM_EMOJI[room.type]}</span>
            <strong>Nog niets voor {room.name.toLowerCase()}</strong>
            <span className="small">Plak een link uit een webshop, zet iets op de lijst om later te zoeken{fal ? ", of laat de AI tips geven" : ""}.</span>
            <button className="primary" onClick={() => openAdd({ roomId: room.id })}>
              ＋ Eerste product toevoegen
            </button>
          </div>
        ) : list.length === 0 ? (
          <p className="muted small center">Niets in deze selectie.</p>
        ) : (
          groups.map((g) => (
            <div className="stack tight" key={g.key}>
              {g.label && (
                <div className="row between">
                  <span className="eyebrow">{g.label}</span>
                  <span className="tiny muted num">{euro(totals(g.items).planned)}</span>
                </div>
              )}
              <div className="items">
                {g.items.map((i) => (
                  <ItemWithAlternatives key={i.id} item={i} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {lightbox !== null && <Lightbox photos={photos.map((p) => p.url)} index={lightbox} onClose={() => setLightbox(null)} />}
      {editing && <RoomSheet room={room} onClose={() => setEditing(false)} />}
    </section>
  );
}

function ItemWithAlternatives({ item }: { item: Item }) {
  const { project } = useApp();
  const alts = alternativesOf(project.items, item.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div onDoubleClick={() => setOpen((o) => !o)}>
        <ItemRow item={item} alternatives={alts.length} />
      </div>
      {alts.length > 0 && (
        <button className="ghost small" style={{ alignSelf: "flex-start", marginLeft: 34, marginTop: -4 }} onClick={() => setOpen((o) => !o)}>
          {open ? "▾ Opties verbergen" : `▸ ${alts.length} optie${alts.length > 1 ? "s" : ""} vergelijken`}
        </button>
      )}
      {open && alts.map((a) => <ItemRow key={a.id} item={a} alt />)}
    </>
  );
}

/** ✨ What is missing, and does it go together? */
function AiCard({ room }: { room: Room }) {
  const { project, update, fal, toast } = useApp();
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [style, setStyle] = useState<StyleCheck | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  if (!fal) return null;
  const withImages = project.items.filter((i) => i.roomId === room.id && !i.alternativeOf && /^https?:/.test(i.image ?? "")).length;

  async function run(kind: "advice" | "style") {
    setError("");
    setBusy(kind);
    try {
      if (kind === "advice") setAdvice(await aiAdvice(project, room));
      else setStyle(await aiStyle(project, room));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const addSuggestion = (s: Advice["suggestions"][number]) => {
    const item: Item = {
      id: newId(),
      roomId: room.id,
      title: s.title,
      images: [],
      estimate: s.estimate,
      qty: s.qty,
      category: s.category,
      status: "idee",
      must: s.must,
      note: "",
      why: s.why,
      addedAt: Date.now(),
      source: "ai",
    };
    update(addItems([item]));
    setAdded((a) => new Set(a).add(s.title));
  };

  return (
    <div className="card ai-card stack">
      <div className="section-head">
        <div className="stack tight">
          <h3>✨ Slimme hulp voor {room.name.toLowerCase()}</h3>
          <p className="small muted">De AI bekijkt de foto&apos;s, de maat en je lijst.</p>
        </div>
        <div className="row wrap-row">
          <button className="ai" onClick={() => run("advice")} disabled={!!busy}>
            {busy === "advice" ? <span className="spinner" /> : "🧭"} Wat mis ik nog? <span className="tiny">({euroCents(FAL_COST.advice)})</span>
          </button>
          <button onClick={() => run("style")} disabled={!!busy || withImages < 2} title={withImages < 2 ? "Voeg eerst minstens 2 producten met foto toe" : undefined}>
            {busy === "style" ? <span className="spinner" /> : "🎨"} Stijlcheck
          </button>
        </div>
      </div>
      {error && <p className="error small">{error}</p>}
      {advice && (
        <div className="stack">
          {advice.summary && <p>{advice.summary}</p>}
          <div className="stack tight">
            {advice.suggestions.map((s) => (
              <div className="suggestion" key={s.title}>
                <span className="emoji">{CATEGORY_EMOJI[s.category]}</span>
                <div className="grow stack tight">
                  <strong className="small">
                    {s.title}
                    {s.qty > 1 ? ` (${s.qty}×)` : ""} {s.must && <span className="chip gold">must</span>}
                  </strong>
                  <span className="tiny muted">
                    {s.estimate ? `± ${euro(s.estimate)}${s.qty > 1 ? " per stuk" : ""} · ` : ""}
                    {s.why}
                  </span>
                </div>
                <button className="small soft" disabled={added.has(s.title)} onClick={() => addSuggestion(s)}>
                  {added.has(s.title) ? "✓" : "＋ Lijst"}
                </button>
              </div>
            ))}
          </div>
          <div className="row wrap-row between">
            {advice.suggestions.some((s) => s.must && !added.has(s.title)) && (
              <button
                className="small"
                onClick={() => {
                  const musts = advice.suggestions.filter((s) => s.must && !added.has(s.title));
                  musts.forEach(addSuggestion);
                  toast(`✓ ${musts.length} must-haves op de lijst`);
                }}
              >
                ＋ Alle must-haves
              </button>
            )}
            <span className="tiny muted">Prijzen zijn schattingen: koppel later een echte link.</span>
          </div>
          {advice.tips.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {advice.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {style && (
        <div className="stack tight">
          <div className="row">
            <strong style={{ fontSize: 22 }}>{style.score}/10</strong>
            <span className="small">{style.verdict}</span>
          </div>
          {style.palette.length > 0 && (
            <div className="palette" title="Kleurenpalet van deze kamer">
              {style.palette.map((c) => (
                <span key={c} style={{ background: c }} title={c} />
              ))}
            </div>
          )}
          {style.tips.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {style.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function RoomSheet({ room, onClose }: { room: Room; onClose: () => void }) {
  const { project, update, toast } = useApp();
  const set = (patch: Partial<Room>) => update(patchRoom(room.id, patch));
  const count = mainItems(itemsIn(project.items, room.id)).length;
  return (
    <Sheet
      title="Kamer bewerken"
      onClose={onClose}
      footer={
        <>
          <button
            className="ghost danger"
            onClick={() => {
              if (count && !confirm(`${room.name} verwijderen? De ${count} items blijven bewaard onder "Nog geen kamer".`)) return;
              const before = project;
              update(removeRoom(room.id));
              onClose();
              go({ view: "kamers" });
              toast(`${room.name} verwijderd`, () => update(() => before));
            }}
          >
            🗑 Verwijderen
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            Klaar
          </button>
        </>
      }
    >
      <label className="field">
        Naam
        <input value={room.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          Soort
          <select value={room.type} onChange={(e) => set({ type: e.target.value as RoomType })}>
            {FURNISHABLE.map((t) => (
              <option key={t} value={t}>
                {ROOM_EMOJI[t]} {roomLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Verdieping
          <input placeholder="Begane grond" value={room.floor ?? ""} onChange={(e) => set({ floor: e.target.value || undefined })} />
        </label>
        <label className="field">
          Oppervlakte (m²)
          <input inputMode="numeric" value={room.area ?? ""} onChange={(e) => set({ area: Number(e.target.value) || undefined })} />
        </label>
      </div>
      <label className="field">
        Budget voor deze kamer
        <EuroInput value={room.budget} onChange={(budget) => set({ budget })} placeholder="geen" />
      </label>
      <label className="field">
        Notitie
        <input placeholder="Bijv. muur 3,40 m breed, raam op het zuiden" value={room.note ?? ""} onChange={(e) => set({ note: e.target.value || undefined })} />
      </label>
    </Sheet>
  );
}
