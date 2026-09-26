"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { proxied } from "@/lib/images";
import { newId } from "@/lib/useProject";
import type { Category, Product, ProductInfo, ProductStatus, Project } from "@/lib/types";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
}

const GROUPS = [
  { id: "meubels", label: "Meubels" },
  { id: "afwerking", label: "Vloeren, verf & afwerking" },
  { id: "accessoires", label: "Verlichting & accessoires" },
] as const;

const euro = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

export function ProductsPanel({ project, update }: Props) {
  const [links, setLinks] = useState("");
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [hideRejected, setHideRejected] = useState(false);

  const setProduct = (id: string, patch: Partial<Product>) =>
    update((p) => ({ ...p, products: p.products.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  async function addLinks() {
    const urls = [...new Set(links.split(/\s+/).filter((u) => /^https?:\/\//i.test(u)))];
    if (!urls.length) return;
    setLinks("");
    setErrors([]);
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
          setErrors((errs) => [...errs, `${host}: ${e instanceof Error ? e.message : e}`]);
        } finally {
          setPending((n) => n - 1);
        }
      }),
    );
  }

  const favorites = project.products.filter((p) => p.status === "favoriet");
  const total = favorites.reduce((sum, p) => sum + (p.priceValue ?? 0), 0);
  const visible = project.products.filter((p) => !(hideRejected && p.status === "afgewezen"));

  return (
    <section className="panel">
      <h2>2. Verzamel meubels, vloeren, verf…</h2>
      <p className="muted">
        Plak links van webshops (IKEA, Kwantum, Leen Bakker, Praxis, Flexa, vtwonen, bol…). Eén of meerdere tegelijk.
      </p>
      <div className="row">
        <textarea
          rows={2}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          placeholder="https://www.ikea.com/nl/nl/p/..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addLinks();
            }
          }}
        />
        <button className="primary" onClick={addLinks} disabled={!links.trim()}>
          Toevoegen
        </button>
      </div>
      {pending > 0 && <p className="muted">{pending} link(s) ophalen…</p>}
      {errors.length > 0 && (
        <p className="error">
          Niet alles kon automatisch worden gelezen — plak bij die kaarten zelf een afbeeldingslink.
          <br />
          {errors.join(" · ")}
        </p>
      )}

      <div className="summary row wrap">
        <span>
          ❤️ {favorites.length} favoriet(en) · totaal <strong>{euro(total)}</strong>
        </span>
        <label className="row">
          <input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} /> Afgewezen
          verbergen
        </label>
      </div>

      {project.products.length === 0 && <p className="empty">Nog geen producten. Plak hierboven je eerste link.</p>}

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
                    <ProductCard key={p.id} product={p} onChange={(patch) => setProduct(p.id, patch)} onRemove={() =>
                      update((pr) => ({ ...pr, products: pr.products.filter((x) => x.id !== p.id) }))
                    } />
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

function ProductCard({
  product: p,
  onChange,
  onRemove,
}: {
  product: Product;
  onChange: (patch: Partial<Product>) => void;
  onRemove: () => void;
}) {
  const toggle = (status: ProductStatus) => onChange({ status: p.status === status ? "optie" : status });
  const imgIndex = p.images.indexOf(p.image);
  const cycle = (dir: number) => {
    if (p.images.length < 2) return;
    onChange({ image: p.images[(imgIndex + dir + p.images.length) % p.images.length] });
  };

  return (
    <article className={`card ${p.status}`}>
      <div className="thumb">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proxied(p.image)} alt={p.title} loading="lazy" />
        ) : p.color ? (
          <div className="swatch" style={{ background: p.color }} />
        ) : (
          <input
            className="image-url"
            placeholder="Plak afbeeldingslink…"
            onBlur={(e) => e.target.value && onChange({ image: e.target.value, images: [e.target.value] })}
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
          {p.price && <strong>{p.price}</strong>}
        </div>
        <select value={p.category} onChange={(e) => onChange({ category: e.target.value as Category })}>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {(p.category === "verf" || p.color) && (
          <label className="row small">
            Kleur <input type="color" value={p.color ?? "#d8cfc4"} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
        )}
        <input placeholder="Notitie (maat, kleur, twijfel…)" value={p.note} onChange={(e) => onChange({ note: e.target.value })} />
        <div className="row actions">
          <button className={p.status === "favoriet" ? "on" : ""} onClick={() => toggle("favoriet")} title="Favoriet">
            ❤️
          </button>
          <button className={p.status === "afgewezen" ? "on" : ""} onClick={() => toggle("afgewezen")} title="Afwijzen">
            👎
          </button>
          <button className="ghost" onClick={onRemove} title="Verwijderen">
            🗑
          </button>
        </div>
      </div>
    </article>
  );
}
