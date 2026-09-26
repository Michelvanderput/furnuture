"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { CATEGORIES, ROOMS } from "@/lib/categories";
import { shareOrDownload } from "@/lib/exportImage";
import { euro, extractLinks, parsePrice, shoppingListCsv, shoppingListText, totalsPerRoom } from "@/lib/shopping";
import type { Category, Dims, Product, ProductInfo, ProductStatus, Project, RoomType } from "@/lib/types";
import { firstWorkingThumb } from "@/lib/images";
import { newId } from "@/lib/useProject";
import { Img } from "./Img";
import { PasteButton } from "./PasteButton";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
}

const GROUPS = [
  { id: "meubels", label: "Meubels" },
  { id: "afwerking", label: "Vloeren, verf & afwerking" },
  { id: "accessoires", label: "Verlichting & accessoires" },
] as const;

/** Rooms you can buy for (exterior and floor plan are not rooms). */
const BUY_ROOMS = ROOMS.filter((r) => !["buitenkant", "plattegrond", "overig"].includes(r.id));

type Filter = "alles" | "favorieten" | "zonder-afgewezen";

const sameLink = (a: string, b: string) => a.replace(/[?#].*$/, "").replace(/\/$/, "") === b.replace(/[?#].*$/, "").replace(/\/$/, "");

export function ProductsPanel({ project, update }: Props) {
  const [links, setLinks] = useState("");
  const [pending, setPending] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("zonder-afgewezen");
  const [copied, setCopied] = useState(false);

  const setProduct = useCallback(
    (id: string, patch: Partial<Product>) =>
      update((p) => ({ ...p, products: p.products.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    [update],
  );
  const removeProduct = useCallback((id: string) => update((p) => ({ ...p, products: p.products.filter((x) => x.id !== id) })), [update]);

  async function addLinks(text = links) {
    const found = extractLinks(text);
    if (!found.length) return;
    const known = found.filter((u) => project.products.some((p) => sameLink(p.url, u)));
    const urls = found.filter((u) => !known.includes(u));
    setLinks("");
    setMessages(known.length ? [`${known.length} link(s) stonden er al in.`] : []);
    if (!urls.length) return;
    setPending((n) => n + urls.length);
    await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch("/api/product", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = (await res.json()) as ProductInfo & { error?: string };
          if (!res.ok) throw new Error(data.error ?? "mislukt");
          update((p) => ({ ...p, products: [...p.products, { ...data, id: newId(), status: "optie", note: "" }] }));
        } catch (e) {
          // Keep the link anyway so the user can fill in the image by hand.
          const host = new URL(url).hostname.replace(/^www\./, "");
          update((p) => ({
            ...p,
            products: [
              ...p.products,
              { id: newId(), url, title: host, image: "", images: [], shop: host, category: "overig", status: "optie", note: "" },
            ],
          }));
          setMessages((m) => [...m, `${host}: ${e instanceof Error ? e.message : e} — plak bij die kaart zelf een afbeeldingslink.`]);
        } finally {
          setPending((n) => n - 1);
        }
      }),
    );
  }

  const favorites = project.products.filter((p) => p.status === "favoriet");
  const total = favorites.reduce((sum, p) => sum + (p.priceValue ?? 0), 0);
  const perRoom = totalsPerRoom(project.products);
  const visible = project.products.filter((p) =>
    filter === "favorieten" ? p.status === "favoriet" : filter === "zonder-afgewezen" ? p.status !== "afgewezen" : true,
  );

  async function copyList() {
    try {
      await navigator.clipboard.writeText(shoppingListText(project.products));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await shareOrDownload(new Blob([shoppingListText(project.products)], { type: "text/plain" }), "boodschappenlijst.txt");
    }
  }

  return (
    <section className="panel">
      <h2>Verzamel meubels, vloeren, verf…</h2>
      <p className="muted">Plak links van webshops (IKEA, Kwantum, Leen Bakker, Praxis, Flexa, vtwonen, bol…), één of meerdere tegelijk.</p>
      <div className="row">
        <textarea
          rows={2}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          placeholder="https://www.ikea.com/nl/nl/p/..."
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addLinks();
            }
          }}
        />
        <div className="stack">
          <PasteButton label="📋 Plak link" onPaste={(t) => addLinks(t)} />
          <button className="primary" onClick={() => addLinks()} disabled={!links.trim()}>
            Toevoegen
          </button>
        </div>
      </div>
      {pending > 0 && <p className="status">⏳ {pending} link(s) ophalen…</p>}
      {messages.map((m) => (
        <p key={m} className="error small">
          {m}
        </p>
      ))}

      {project.products.length > 0 && (
        <div className="summary">
          <div className="row wrap between">
            <span>
              ❤️ {favorites.length} favoriet(en) · totaal <strong>{euro(total)}</strong>
            </span>
            <div className="row wrap">
              <div className="segmented" role="group" aria-label="Filter">
                {(
                  [
                    ["zonder-afgewezen", "Alles"],
                    ["favorieten", "❤️ Favorieten"],
                    ["alles", "Ook afgewezen"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {favorites.length > 0 && (
                <>
                  <button onClick={copyList}>{copied ? "✓ Gekopieerd" : "📋 Lijst kopiëren"}</button>
                  <button
                    onClick={() => shareOrDownload(new Blob([shoppingListCsv(project.products)], { type: "text/csv" }), "boodschappenlijst.csv")}
                  >
                    ⬇ Excel
                  </button>
                </>
              )}
            </div>
          </div>
          {perRoom.length > 1 && (
            <div className="budget row wrap">
              {perRoom.map((r) => (
                <span key={r.label} className="chip">
                  {r.label}: <strong>{euro(r.total)}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {project.products.length === 0 && <p className="empty">Nog geen producten. Plak hierboven je eerste link.</p>}
      {project.products.length > 0 && visible.length === 0 && <p className="empty">Niets in dit filter.</p>}

      {GROUPS.map((group) => {
        const cats = CATEGORIES.filter((c) => c.group === group.id)
          .map((c) => ({ ...c, items: visible.filter((p) => p.category === c.id) }))
          .filter((c) => c.items.length > 0);
        if (!cats.length) return null;
        return (
          <div key={group.id}>
            <h3 className="group">{group.label}</h3>
            {cats.map((cat) => (
              <div key={cat.id} className="category">
                <h4>
                  {cat.label} <span className="count">{cat.items.length}</span>
                </h4>
                <div className="grid products">
                  {cat.items.map((p) => (
                    <ProductCard key={p.id} product={p} onChange={setProduct} onRemove={removeProduct} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

/** Memoised: typing a note re-renders one card, not all of them. */
const ProductCard = memo(function ProductCard({
  product: p,
  onChange,
  onRemove,
}: {
  product: Product;
  onChange: (id: string, patch: Partial<Product>) => void;
  onRemove: (id: string) => void;
}) {
  const set = (patch: Partial<Product>) => onChange(p.id, patch);
  const toggle = (status: ProductStatus) => set({ status: p.status === status ? "optie" : status });
  const imgIndex = p.images.indexOf(p.image);
  const cycle = (dir: number) => {
    if (p.images.length < 2) return;
    set({ image: p.images[(imgIndex + dir + p.images.length) % p.images.length], thumb: undefined });
  };
  // A trimmed thumbnail kept with the product; if the chosen image does not load, the next one that does is taken.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!p.image || p.thumb) return;
    let live = true;
    const order = [p.image, ...p.images.slice(imgIndex + 1), ...p.images.slice(0, Math.max(0, imgIndex))].filter((u, i, a) => u && a.indexOf(u) === i);
    firstWorkingThumb(order).then((r) => {
      if (!live) return;
      if (r) set(r);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.image, p.thumb]);

  return (
    <article className={`card ${p.status}`}>
      <div className="thumb">
        {p.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumb} alt={p.title} decoding="async" />
        ) : p.image && !failed ? (
          <Img src={p.image} alt={p.title} loading="lazy" />
        ) : p.color ? (
          <div className="swatch" style={{ background: p.color }} />
        ) : (
          <input
            className="image-url"
            placeholder="Plak afbeeldingslink…"
            onBlur={(e) => e.target.value && (setFailed(false), set({ image: e.target.value, images: [e.target.value, ...p.images], thumb: undefined }))}
          />
        )}
        {p.images.length > 1 && (
          <div className="cycle">
            <button className="small" onClick={() => cycle(-1)} aria-label="Vorige afbeelding">
              ‹
            </button>
            <button className="small" onClick={() => cycle(1)} aria-label="Volgende afbeelding">
              ›
            </button>
          </div>
        )}
      </div>
      <div className="body">
        <a href={p.url} target="_blank" rel="noreferrer" className="title" title={p.title}>
          {p.title}
        </a>
        <div className="meta">
          <span>{p.shop}</span>
          {p.price ? (
            <strong>{p.price}</strong>
          ) : (
            <input
              className="price-input"
              inputMode="decimal"
              placeholder="Prijs"
              defaultValue={p.priceValue ? String(p.priceValue).replace(".", ",") : ""}
              onBlur={(e) => set({ priceValue: parsePrice(e.target.value) })}
              aria-label="Prijs"
            />
          )}
        </div>
        <div className="row two">
          <select value={p.category} onChange={(e) => set({ category: e.target.value as Category })} aria-label="Soort">
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={p.room ?? ""} onChange={(e) => set({ room: (e.target.value || undefined) as RoomType | undefined })} aria-label="Voor ruimte">
            <option value="">Ruimte…</option>
            {BUY_ROOMS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {p.category !== "verf" && <DimsInput dims={p.dims} onChange={(dims) => set({ dims })} />}
        {(p.category === "verf" || p.color) && (
          <label className="row small">
            Kleur <input type="color" value={p.color ?? "#d8cfc4"} onChange={(e) => set({ color: e.target.value })} />
          </label>
        )}
        <input placeholder="Notitie (maat, kleur, twijfel…)" value={p.note} onChange={(e) => set({ note: e.target.value })} />
        <div className="row actions">
          <button className={p.status === "favoriet" ? "on" : ""} onClick={() => toggle("favoriet")} title="Favoriet" aria-pressed={p.status === "favoriet"}>
            ❤️
          </button>
          <button className={p.status === "afgewezen" ? "on" : ""} onClick={() => toggle("afgewezen")} title="Afwijzen" aria-pressed={p.status === "afgewezen"}>
            👎
          </button>
          <button className="ghost" onClick={() => confirm(`"${p.title}" verwijderen?`) && onRemove(p.id)} title="Verwijderen">
            🗑
          </button>
        </div>
      </div>
    </article>
  );
});

/** Width × depth × height in cm (read from the shop when possible). Saved when a field loses focus. */
function DimsInput({ dims, onChange }: { dims?: Dims; onChange: (d: Dims | undefined) => void }) {
  const field = (key: keyof Dims, label: string) => (
    <input
      key={`${key}:${dims?.[key] ?? ""}`}
      inputMode="decimal"
      placeholder={label}
      aria-label={label}
      title={label}
      defaultValue={dims?.[key] ? String(Math.round(dims[key]!)) : ""}
      onBlur={(e) => {
        const n = parseFloat(e.target.value.replace(",", "."));
        const next = { ...dims, [key]: Number.isFinite(n) && n > 0 ? n : undefined };
        onChange(next.w || next.d || next.h ? next : undefined);
      }}
    />
  );
  return (
    <div className="dims" title="Breedte × diepte × hoogte in cm">
      {field("w", "B")}
      <span>×</span>
      {field("d", "D")}
      <span>×</span>
      {field("h", "H")}
      <span className="muted">cm</span>
    </div>
  );
}
