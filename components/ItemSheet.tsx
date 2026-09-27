"use client";

import { useState } from "react";
import { aiAlternatives, type Alternative } from "@/lib/ai";
import { CATEGORIES } from "@/lib/categories";
import { euroCents, FAL_COST } from "@/lib/fal";
import { productThumb } from "@/lib/images";
import { addItems, chooseAlternative, duplicateItem, moveItem, patchItem, removeItem } from "@/lib/items";
import { itemFromLink, priceChange, refreshPrice } from "@/lib/products";
import { alternativesOf, euro, lineCost, STATUS } from "@/lib/shopping";
import type { Category, Item } from "@/lib/types";
import { ArrowSquareOut, ArrowsClockwise, Copy, MagnifyingGlass, Plus, Sparkle, Star, Trash } from "@phosphor-icons/react";
import { useApp } from "./app";
import { CategoryIcon, I, STATUS_ICON } from "./icons";
import { Img } from "./Img";
import { ItemThumb, Price } from "./ItemRow";
import { EuroInput, Sheet, Stepper } from "./ui";

export function ItemSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { project, update, toast, openAdd, openItem, fal } = useApp();
  const item = project.items.find((i) => i.id === id)!;
  const main = item.alternativeOf ? project.items.find((i) => i.id === item.alternativeOf) : undefined;
  const alts = alternativesOf(project.items, item.id);
  const set = (patch: Partial<Item>) => update(patchItem(item.id, patch));
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [found, setFound] = useState<Alternative[] | null>(null);
  const change = priceChange(item);

  async function checkPrice() {
    setBusy("price");
    setNote("");
    try {
      const next = await refreshPrice(item);
      if (next) {
        update(patchItem(item.id, { price: next.price, priceHistory: next.priceHistory }));
        setNote(`Nieuwe prijs: ${euro(next.price!, true)} (was ${euro(item.price ?? 0, true)})`);
      } else setNote("Prijs is niet veranderd.");
    } catch (e) {
      setNote(`Prijs checken lukte niet: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  }

  /** A placeholder ("eettafel ± € 400") gets a real product: its data fills the item in. */
  async function fillFromLink() {
    if (!/^https?:\/\//.test(link.trim())) return;
    setBusy("link");
    setNote("");
    const { item: got, error } = await itemFromLink(link.trim(), item.roomId);
    setBusy("");
    if (error) setNote(error);
    set({
      url: got.url,
      title: got.title !== new URL(got.url!).hostname.replace(/^www\./, "") ? got.title : item.title,
      image: got.image,
      images: got.images,
      shop: got.shop,
      price: got.price,
      dims: got.dims ?? item.dims,
      category: got.category !== "overig" ? got.category : item.category,
      priceHistory: got.priceHistory,
      thumb: undefined,
      source: "link",
      status: item.status === "idee" ? "gekozen" : item.status,
    });
    if (got.image) productThumb(got.image).then((thumb) => update(patchItem(item.id, { thumb }))).catch(() => undefined);
    setLink("");
  }

  async function findAlternatives() {
    setBusy("alt");
    setNote("");
    try {
      setFound(await aiAlternatives(item, (m) => m && setNote(m)));
      setNote("");
    } catch (e) {
      setNote(`Zoeken lukte niet: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  }

  async function addAlternative(a: Alternative) {
    setBusy(a.url);
    const { item: got } = await itemFromLink(a.url, item.roomId);
    update(addItems([{ ...got, title: got.title.length > 3 && !got.title.includes(".") ? got.title : a.title, price: got.price ?? a.price, shop: got.shop ?? a.shop, alternativeOf: item.id, source: "ai", why: a.why }]));
    if (got.image) productThumb(got.image).then((thumb) => update(patchItem(got.id, { thumb }))).catch(() => undefined);
    setFound((f) => f?.filter((x) => x.url !== a.url) ?? null);
    setBusy("");
    toast("Toegevoegd als optie");
  }

  const pickImage = (image: string) => {
    set({ image, thumb: undefined });
    productThumb(image).then((thumb) => update(patchItem(item.id, { thumb }))).catch(() => undefined);
  };

  return (
    <Sheet
      wide
      title={main ? "Optie" : "Product"}
      onClose={onClose}
      footer={
        <>
          <button
            className="ghost danger"
            onClick={() => {
              const before = project;
              update(removeItem(item.id));
              onClose();
              toast("Verwijderd", () => update(() => before));
            }}
          >
            <I icon={Trash} /> Verwijderen
          </button>
          <button
            className="ghost"
            onClick={() => {
              update(duplicateItem(item.id));
              toast("Gedupliceerd");
            }}
          >
            <I icon={Copy} /> Dupliceren
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            Klaar
          </button>
        </>
      }
    >
      {main && (
        <div className="card tint row between wrap-row">
          <span className="small">
            Dit is een optie voor <strong>{main.title}</strong>. Alleen de gekozen versie telt mee in het totaal.
          </span>
          <button
            className="primary small"
            onClick={() => {
              update(chooseAlternative(item.id));
              toast("Gekozen");
            }}
          >
            Kies deze
          </button>
        </div>
      )}

      <div className="row top wrap-row" style={{ gap: 18 }}>
        <div className="stack tight" style={{ width: 180 }}>
          <div style={{ width: 180, height: 180, borderRadius: 16, overflow: "hidden", border: "1px solid var(--line)", background: item.image || item.thumb ? "#fff" : "var(--surface-2)", display: "grid", placeItems: "center" }}>
            {item.image || item.thumb ? <Img src={item.image ?? item.thumb!} width={480} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ color: "var(--stone)" }}><CategoryIcon category={item.category} size={56} /></span>}
          </div>
          {item.images.length > 1 && (
            <div className="row wrap-row" style={{ gap: 6 }}>
              {item.images.slice(0, 8).map((u) => (
                <button key={u} className="small icon" style={{ padding: 0, overflow: "hidden", outline: u === item.image ? "2px solid var(--accent)" : undefined }} onClick={() => pickImage(u)} aria-label="Andere foto">
                  <Img src={u} alt="" style={{ width: 32, height: 32, objectFit: "cover" }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="stack grow" style={{ minWidth: 260 }}>
          <label className="field">
            Naam
            <input value={item.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              {item.price !== undefined || item.url ? "Prijs per stuk" : "Richtprijs"}
              {item.price !== undefined || item.url ? (
                <EuroInput value={item.price} onChange={(price) => set({ price })} placeholder="onbekend" />
              ) : (
                <EuroInput value={item.estimate} onChange={(estimate) => set({ estimate })} placeholder="schatting" />
              )}
            </label>
            <label className="field">
              Aantal
              <Stepper value={item.qty} onChange={(qty) => set({ qty })} />
            </label>
            <div className="field">
              <span className="field" style={{ gap: 0 }}>
                Totaal
              </span>
              <strong style={{ fontSize: 20 }}>
                <Price item={item} />
              </strong>
            </div>
          </div>
          <div className="field-row">
            <label className="field">
              Kamer
              <select value={item.roomId ?? ""} onChange={(e) => update(moveItem(main?.id ?? item.id, e.target.value || null))}>
                {project.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
                <option value="">Nog geen kamer</option>
              </select>
            </label>
            <label className="field">
              Soort
              <select value={item.category} onChange={(e) => set({ category: e.target.value as Category })}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!main && (
            <div className="row wrap-row">
              <div className="segmented">
                {STATUS.map((s) => (
                  <button key={s.id} className={item.status === s.id ? "on" : ""} onClick={() => set({ status: s.id })}>
                    <I icon={STATUS_ICON[s.id]} size={16} /> {s.label}
                  </button>
                ))}
              </div>
              <button className={`chip ${item.must ? "gold" : ""}`} onClick={() => set({ must: !item.must })} title="Must-have: dit moet er echt zijn als je verhuist">
                <I icon={Star} size={14} weight={item.must ? "fill" : "regular"} /> Must-have
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="stack tight">
        {item.url ? (
          <div className="row wrap-row">
            <a className="btn" href={item.url} target="_blank" rel="noreferrer">
              Bekijk bij {item.shop ?? "de winkel"} <I icon={ArrowSquareOut} size={16} />
            </a>
            <button onClick={checkPrice} disabled={!!busy}>
              {busy === "price" ? <span className="spinner" /> : <I icon={ArrowsClockwise} />} Prijs checken
            </button>
            {change !== null && <span className={`chip ${change < 0 ? "ok" : "danger"}`}>{change < 0 ? `${euro(-change)} goedkoper dan eerst` : `${euro(change)} duurder dan eerst`}</span>}
          </div>
        ) : (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              fillFromLink();
            }}
          >
            <input type="url" placeholder="Gevonden? Plak hier de link van het product" value={link} onChange={(e) => setLink(e.target.value)} />
            <button className="primary" disabled={!link || !!busy}>
              {busy === "link" ? <span className="spinner" /> : "Koppel"}
            </button>
          </form>
        )}
        {note && <p className="small muted">{note}</p>}
      </div>

      <label className="field">
        Notitie
        <textarea rows={2} placeholder="Kleur, maat, levertijd, korting…" value={item.note} onChange={(e) => set({ note: e.target.value })} />
      </label>

      <details>
        <summary>Maten{item.dims && (item.dims.w || item.dims.d || item.dims.h) ? `: ${[item.dims.w, item.dims.d, item.dims.h].map((n) => n ?? "?").join(" × ")} cm` : ""}</summary>
        <div className="field-row">
          {(["w", "d", "h"] as const).map((k) => (
            <label className="field" key={k}>
              {k === "w" ? "Breedte" : k === "d" ? "Diepte" : "Hoogte"} (cm)
              <input inputMode="numeric" value={item.dims?.[k] ?? ""} onChange={(e) => set({ dims: { ...item.dims, [k]: Number(e.target.value) || undefined } })} />
            </label>
          ))}
        </div>
      </details>

      {!main && (
        <div className="stack">
          <hr className="divider" />
          <div className="section-head">
            <div>
              <h2 style={{ fontSize: 20 }}>Opties vergelijken</h2>
              <p className="tiny muted">Twijfel je? Zet alternatieven naast elkaar en kies er één.</p>
            </div>
            <div className="row wrap-row">
              <button className="small" onClick={() => (onClose(), openAdd({ alternativeOf: item.id }))}>
                <I icon={Plus} /> Optie
              </button>
              {fal && (
                <button className="small ai" onClick={findAlternatives} disabled={!!busy}>
                  {busy === "alt" ? <span className="spinner" /> : <I icon={Sparkle} />} Zoek alternatieven <span className="cost">{euroCents(FAL_COST.alternatives)}</span>
                </button>
              )}
            </div>
          </div>
          {alts.length > 0 && (
            <div className="table-wrap" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th>Product</th>
                    <th className="r">Prijs</th>
                    <th className="r">Verschil</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[item, ...alts].map((x) => {
                    const diff = lineCost(x).value - lineCost(item).value;
                    return (
                      <tr key={x.id}>
                        <td style={{ width: 56 }}>
                          <div className="item" style={{ padding: 0, border: 0, background: "transparent" }}>
                            <ItemThumb item={x} size={48} />
                          </div>
                        </td>
                        <td>
                          <a onClick={() => x.id !== item.id && openItem(x.id)} style={{ cursor: "pointer", color: "var(--ink)", fontWeight: 600 }}>
                            {x.title}
                          </a>
                          <div className="tiny muted">
                            {x.shop}
                            {x.dims?.w ? ` · ${[x.dims.w, x.dims.d, x.dims.h].filter(Boolean).join("×")} cm` : ""}
                            {x.why ? ` · ${x.why}` : ""}
                          </div>
                        </td>
                        <td className="r">
                          <Price item={x} />
                        </td>
                        <td className="r">{x.id === item.id ? <span className="chip accent">gekozen</span> : <span className={diff < 0 ? "chip ok" : diff > 0 ? "chip danger" : "chip"}>{diff === 0 ? "=" : `${diff < 0 ? "−" : "+"}${euro(Math.abs(diff))}`}</span>}</td>
                        <td className="r">
                          {x.id !== item.id && (
                            <button
                              className="small soft"
                              onClick={() => {
                                update(chooseAlternative(x.id));
                                onClose();
                                openItem(x.id);
                                toast("Gekozen");
                              }}
                            >
                              Kies
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {found && (
            <div className="stack tight">
              {found.length === 0 && <p className="small muted">Geen goede alternatieven gevonden.</p>}
              {found.map((a) => (
                <div className="suggestion" key={a.url}>
                  <span className="icon-badge accent">
                    <I icon={MagnifyingGlass} size={20} />
                  </span>
                  <div className="grow stack tight">
                    <strong className="small">{a.title}</strong>
                    <span className="tiny muted">
                      {a.shop}
                      {a.price ? ` · ${euro(a.price, true)}` : ""} · {a.why}
                    </span>
                  </div>
                  <div className="row">
                    <a className="btn small icon" href={a.url} target="_blank" rel="noreferrer" aria-label={`${a.title} bekijken bij ${a.shop}`}>
                      <I icon={ArrowSquareOut} />
                    </a>
                    <button className="small soft" disabled={!!busy} onClick={() => addAlternative(a)}>
                      {busy === a.url ? <span className="spinner" /> : <><I icon={Plus} /> Optie</>}
                    </button>
                  </div>
                </div>
              ))}
              <p className="tiny muted">Gevonden door AI op internet: controleer prijs en maten in de winkel.</p>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
