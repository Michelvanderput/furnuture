"use client";

import { ArrowSquareOut, Check, Plus, Sparkle } from "@phosphor-icons/react";
import { useState } from "react";
import { aiAlternatives } from "@/lib/ai";
import { euroCents, FAL_COST } from "@/lib/fal";
import { productThumb } from "@/lib/images";
import { addItems, isPlaceholder, patchItem } from "@/lib/items";
import { verifyFound, type Found } from "@/lib/products";
import { newId } from "@/lib/rooms";
import { euro, lineCost } from "@/lib/shopping";
import type { Item } from "@/lib/types";
import { useApp } from "./app";
import { I } from "./icons";
import { Img } from "./Img";

/**
 * ✨ Real products on the web: alternatives for a product, or candidates for something
 * still to find. The AI finds the links; each shop page is then read for its photo,
 * current price and size, so every card shows the real product.
 */
/** What was found per item in this session: after choosing one, the others can still be added as options. */
const lastFound = new Map<string, Found[]>();

export function ProductFinder({ item }: { item: Item }) {
  const { project, update, toast, fal } = useApp();
  const [phase, setPhase] = useState<"" | "ai" | "shops">("");
  const [found, setFoundState] = useState<Found[] | null>(() => lastFound.get(item.id)?.filter((f) => f.url !== item.url) ?? null);
  const setFound = (list: Found[] | null) => (list ? lastFound.set(item.id, list) : lastFound.delete(item.id), setFoundState(list));
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const placeholder = isPlaceholder(item);
  const current = lineCost(item).known ? lineCost(item).value / item.qty : undefined;

  if (!fal) return null;

  async function search() {
    setError("");
    setFound(null);
    setPhase("ai");
    try {
      const options = await aiAlternatives(item, project);
      setPhase("shops");
      const list = await verifyFound(options);
      setFound(list);
      if (!list.length) setError("De gevonden links leidden niet naar producten. Probeer het nog eens, of plak zelf een link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("");
    }
  }

  const thumbFor = (id: string, image?: string) => image && productThumb(image).then((thumb) => update(patchItem(id, { thumb }))).catch(() => undefined);

  /** The placeholder becomes this product. */
  function choose(f: Found) {
    update(
      patchItem(item.id, {
        url: f.url,
        title: f.title,
        shop: f.shop,
        image: f.image,
        images: f.images,
        price: f.price,
        estimate: item.estimate,
        dims: f.dims ?? item.dims,
        category: f.category && f.category !== "overig" ? f.category : item.category,
        priceHistory: f.price ? [{ at: new Date().toISOString().slice(0, 10), value: f.price }] : undefined,
        thumb: undefined,
        source: "ai",
        why: f.why,
        status: item.status === "idee" ? "gekozen" : item.status,
      }),
    );
    thumbFor(item.id, f.image);
    toast("Gekozen. De andere kun je hieronder als optie toevoegen.");
  }

  /** Added next to the current product, to compare. */
  function addOption(f: Found) {
    const id = newId();
    update(
      addItems([
        {
          id,
          roomId: item.roomId,
          title: f.title,
          url: f.url,
          image: f.image,
          images: f.images,
          shop: f.shop,
          price: f.price,
          qty: item.qty,
          category: f.category && f.category !== "overig" ? f.category : item.category,
          status: "idee",
          note: "",
          dims: f.dims,
          alternativeOf: item.id,
          priceHistory: f.price ? [{ at: new Date().toISOString().slice(0, 10), value: f.price }] : undefined,
          addedAt: Date.now(),
          source: "ai",
          why: f.why,
        },
      ]),
    );
    thumbFor(id, f.image);
    setAdded((a) => new Set(a).add(f.url));
  }

  return (
    <div className="stack">
      <div className="row wrap-row between">
        <p className="small muted" style={{ maxWidth: 440 }}>
          {placeholder
            ? "De AI zoekt echte producten die hierbij passen, bij Nederlandse webshops. Kies er een en hij komt op je lijst."
            : "De AI zoekt vergelijkbare producten, liefst goedkoper. Zet ze als optie naast je keuze."}
        </p>
        <button className={placeholder ? "accent" : "ai"} onClick={search} disabled={!!phase}>
          {phase ? <span className="spinner" /> : <I icon={Sparkle} />}
          {phase === "ai" ? "Zoeken op internet…" : phase === "shops" ? "Winkels bekijken…" : placeholder ? "Zoek producten" : "Zoek alternatieven"}
          {!phase && <span className="cost">{euroCents(FAL_COST.alternatives)}</span>}
        </button>
      </div>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {(!!phase || !!found?.length) && (
        <div className="found-grid" aria-busy={!!phase}>
          {phase
            ? [0, 1, 2].map((n) => (
                <div className="found-card skeleton" key={n} aria-hidden>
                  <div className="pic" />
                  <div className="body">
                    <span className="line" />
                    <span className="line short" />
                  </div>
                </div>
              ))
            : found!.map((f) => {
                const diff = current !== undefined && f.price !== undefined ? f.price - current : undefined;
                const done = added.has(f.url);
                return (
                  <article className="found-card" key={f.url}>
                    <a className="pic" href={f.url} target="_blank" rel="noreferrer" aria-label={`${f.title} bekijken bij ${f.shop}`}>
                      {f.image ? <Img src={f.image} width={480} alt="" loading="lazy" /> : <span className="tiny muted">geen foto</span>}
                    </a>
                    <div className="body">
                      <span className="title">{f.title}</span>
                      <span className="tiny muted">
                        {f.shop}
                        {f.dims?.w ? ` · ${[f.dims.w, f.dims.d, f.dims.h].filter(Boolean).join(" × ")} cm` : ""}
                      </span>
                      <span className="row wrap-row" style={{ gap: 6 }}>
                        {f.price !== undefined ? <span className="amount">{euro(f.price, f.price % 1 !== 0)}</span> : <span className="amount none">prijs?</span>}
                        {diff !== undefined && Math.abs(diff) >= 1 && (
                          <span className={`chip ${diff < 0 ? "ok" : "danger"}`}>
                            {diff < 0 ? `${euro(-diff)} goedkoper` : `${euro(diff)} duurder`}
                          </span>
                        )}
                      </span>
                      {f.why && <span className="tiny muted">{f.why}</span>}
                      {!f.verified && <span className="tiny muted">Niet gecontroleerd bij de winkel</span>}
                    </div>
                    <div className="actions">
                      <a className="btn small icon" href={f.url} target="_blank" rel="noreferrer" aria-label={`${f.title} bekijken bij ${f.shop}`}>
                        <I icon={ArrowSquareOut} />
                      </a>
                      {placeholder ? (
                        <button className="small primary grow" onClick={() => choose(f)}>
                          <I icon={Check} weight="bold" /> Kies deze
                        </button>
                      ) : (
                        <button className="small soft grow" disabled={done} onClick={() => addOption(f)}>
                          {done ? <I icon={Check} weight="bold" /> : <I icon={Plus} />} {done ? "Optie toegevoegd" : "Als optie"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
        </div>
      )}
      {found && found.length > 0 && <p className="tiny muted">Gevonden door AI; foto, prijs en maten komen van de winkel zelf. Controleer levertijd en kleur.</p>}
    </div>
  );
}
