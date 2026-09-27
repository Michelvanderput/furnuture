"use client";

import { useEffect, useRef, useState } from "react";
import { aiScreenshot } from "@/lib/ai";
import { CATEGORIES, guessCategory } from "@/lib/categories";
import { euroCents, FAL_COST } from "@/lib/fal";
import { fileToDataUrl, firstWorkingThumb } from "@/lib/images";
import { addItems, addOrFill, patchItem } from "@/lib/items";
import { itemFromLink, sameLink } from "@/lib/products";
import { newId } from "@/lib/rooms";
import { extractLinks } from "@/lib/shopping";
import type { Category, Item } from "@/lib/types";
import { Camera, LinkSimple, PencilSimple } from "@phosphor-icons/react";
import { useApp } from "./app";
import { I } from "./icons";
import { PasteButton } from "./PasteButton";
import { EuroInput, Sheet } from "./ui";

type Mode = "link" | "screenshot" | "zelf";

export function AddSheet({ roomId: initialRoom, alternativeOf, links: initialLinks, onClose }: { roomId?: string | null; alternativeOf?: string; links?: string[]; onClose: () => void }) {
  const { project, update, toast, fal } = useApp();
  const main = alternativeOf ? project.items.find((i) => i.id === alternativeOf) : undefined;
  const [roomId, setRoomId] = useState<string | null>(main?.roomId ?? initialRoom ?? null);
  const [mode, setMode] = useState<Mode>("link");
  const [text, setText] = useState(initialLinks?.join("\n") ?? "");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const started = useRef(false);

  const links = extractLinks(text);

  /** Gets the product data behind each link (one at a time: kind to the shops), then adds them. */
  async function addLinks(list = links) {
    if (!list.length) return;
    setErrors([]);
    const added: Item[] = [];
    const failed: string[] = [];
    for (const [n, url] of list.entries()) {
      if (!alternativeOf && project.items.some((i) => i.url && sameLink(i.url, url))) {
        failed.push(`Staat al op je lijst: ${url.slice(0, 60)}…`);
        continue;
      }
      setBusy(list.length > 1 ? `Ophalen ${n + 1} van ${list.length}…` : "Ophalen…");
      const { item, error, notAProduct } = await itemFromLink(url, roomId);
      if (notAProduct) {
        failed.push(`${error} Niet toegevoegd.`);
        continue;
      }
      if (error) failed.push(`${error} De link staat op je lijst; vul naam en prijs zelf in${fal ? " of gebruik een screenshot" : ""}.`);
      added.push({ ...item, alternativeOf, must: main?.must });
    }
    setBusy("");
    if (added.length) {
      const before = project;
      // A product for something still to find ("Bank (3-zits)", ± € 800) takes its place instead of standing next to it.
      const { apply, replaced: planned } = addOrFill(added);
      apply(project); // what will be replaced, for the message; applied to the latest state below
      const replaced = planned.map((r) => ({ item: r.product, placeholder: r.placeholder }));
      const fresh = added.filter((a) => !replaced.some((r) => r.item.id === a.id));
      update(apply);
      // Thumbnails in the background: instant list, and the photo survives an expiring shop link.
      for (const it of [...fresh, ...replaced.map((r) => ({ ...r.item, id: r.placeholder.id }))]) {
        const urls = [it.image, ...it.images].filter((u): u is string => !!u);
        if (urls.length) firstWorkingThumb(urls).then((r) => r && update(patchItem(it.id, { thumb: r.thumb, image: r.image })));
      }
      const text =
        replaced.length === 1 && !fresh.length
          ? `${replaced[0].item.title.slice(0, 40)} vervangt "${replaced[0].placeholder.title.slice(0, 30)}"`
          : added.length === 1
            ? `${added[0].title.slice(0, 50)} toegevoegd`
            : `${added.length} producten toegevoegd${replaced.length ? `, ${replaced.length} op de plek van een "nog te vinden"` : ""}`;
      toast(text, () => update(() => before));
    }
    if (failed.length) setErrors(failed);
    else onClose();
  }

  // Links that came with opening (pasted on the page) are fetched right away.
  useEffect(() => {
    if (initialLinks?.length && !started.current) {
      started.current = true;
      addLinks(initialLinks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet
      title={main ? `Alternatief voor ${main.title.slice(0, 40)}` : "Toevoegen"}
      onClose={onClose}
      footer={
        mode === "link" ? (
          <>
            <button className="ghost" onClick={onClose}>
              Annuleren
            </button>
            <button className="primary" disabled={!links.length || !!busy} onClick={() => addLinks()}>
              {busy ? (
                <>
                  <span className="spinner" /> {busy}
                </>
              ) : links.length > 1 ? (
                `${links.length} links toevoegen`
              ) : (
                "Toevoegen"
              )}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="row wrap-row between">
        <div className="segmented" role="tablist">
          <button className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>
            <I icon={LinkSimple} /> Link
          </button>
          <button className={mode === "screenshot" ? "on" : ""} onClick={() => setMode("screenshot")}>
            <I icon={Camera} /> Screenshot
          </button>
          <button className={mode === "zelf" ? "on" : ""} onClick={() => setMode("zelf")}>
            <I icon={PencilSimple} /> Zelf
          </button>
        </div>
        {!main && (
          <select value={roomId ?? ""} onChange={(e) => setRoomId(e.target.value || null)} style={{ width: "auto" }} aria-label="Kamer">
            {project.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="">Nog geen kamer</option>
          </select>
        )}
      </div>

      {mode === "link" && (
        <div className="stack">
          <div className="stack tight">
            <textarea
              autoFocus
              rows={3}
              placeholder={"Plak een of meer productlinks, bijvoorbeeld\nhttps://www.ikea.com/nl/nl/p/…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="row between">
              <span className="tiny muted">
                {links.length ? `${links.length} link${links.length > 1 ? "s" : ""} gevonden` : "Werkt met bijna elke webshop: foto, prijs en maten komen vanzelf."}
              </span>
              <PasteButton onPaste={(t) => setText((x) => (x ? `${x}\n${t}` : t))} />
            </div>
          </div>
          {errors.length > 0 && (
            <div className="stack tight">
              {errors.map((e) => (
                <p key={e} className="small error">
                  {e}
                </p>
              ))}
            </div>
          )}
          <p className="tiny muted">Tip: kopieer een link en plak hem ergens op de pagina (Ctrl/⌘+V): dan komt hij direct in de kamer die je bekijkt.</p>
        </div>
      )}

      {mode === "screenshot" && <FromScreenshot roomId={roomId} alternativeOf={alternativeOf} onDone={onClose} />}
      {mode === "zelf" && <Manual roomId={roomId} alternativeOf={alternativeOf} onDone={onClose} />}
    </Sheet>
  );
}

/** ✨ A screenshot of a product page (when a shop blocks reading it, or from Instagram or a store): the AI reads it. */
function FromScreenshot({ roomId, alternativeOf, onDone }: { roomId: string | null; alternativeOf?: string; onDone: () => void }) {
  const { project, update, toast, fal } = useApp();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy("Screenshot verkleinen…");
    try {
      const image = await fileToDataUrl(file, 1280);
      const p = await aiScreenshot(image, setBusy);
      const thumb = await fileToDataUrl(file, 360);
      const item: Item = {
        id: newId(),
        roomId,
        title: p.title,
        url: p.url,
        images: [],
        thumb,
        shop: p.shop,
        price: p.price,
        qty: 1,
        category: p.category,
        status: "idee",
        note: "",
        dims: p.dims,
        addedAt: Date.now(),
        source: "screenshot",
        alternativeOf,
      };
      const before = project;
      const { apply, replaced } = addOrFill([item]);
      apply(project);
      const taken = replaced[0]?.placeholder.title;
      update(apply);
      toast(taken ? `${p.title.slice(0, 40)} vervangt "${taken.slice(0, 30)}"` : `${p.title.slice(0, 50)} toegevoegd`, () => update(() => before));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (!fal) {
    return (
      <p className="muted small">
        Met AI (fal.ai) lees je een product uit een screenshot: handig als een webshop het ophalen blokkeert. Stel fal.ai in via ⚙︎ Instellingen.
      </p>
    );
  }
  return (
    <div className="stack">
      <label
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          read(e.dataTransfer.files[0]);
        }}
      >
        {busy ? (
          <span className="status-line">
            <span className="spinner" /> {busy}
          </span>
        ) : (
          <>
            <span className="icon-badge accent">
              <I icon={Camera} size={22} />
            </span>
            <strong>Kies of sleep een screenshot</strong>
            <div className="tiny">De AI leest naam, prijs, winkel en maten ({euroCents(FAL_COST.screenshot)}).</div>
          </>
        )}
        <input type="file" accept="image/*" hidden onChange={(e) => read(e.target.files?.[0])} />
      </label>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** Typed in: something to find later ("Eettafel ± € 400"), with a link added when you found it. */
function Manual({ roomId, alternativeOf, onDone }: { roomId: string | null; alternativeOf?: string; onDone: () => void }) {
  const { update, toast } = useApp();
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState<number | undefined>();
  const [category, setCategory] = useState<Category | "">("");
  const [qty, setQty] = useState(1);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const item: Item = {
          id: newId(),
          roomId,
          title: title.trim(),
          images: [],
          estimate,
          qty,
          category: category || guessCategory(title),
          status: "idee",
          note: "",
          addedAt: Date.now(),
          source: "manual",
          alternativeOf,
        };
        update(addItems([item]));
        toast(`${item.title.slice(0, 50)} toegevoegd`);
        onDone();
      }}
    >
      <label className="field">
        Wat?
        <input autoFocus placeholder="Bijv. eettafel, gordijnen, bureaulamp" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          Richtprijs per stuk
          <EuroInput value={estimate} onChange={setEstimate} placeholder="0" />
        </label>
        <label className="field">
          Aantal
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="field">
          Soort
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            <option value="">Automatisch</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="primary" disabled={!title.trim()}>
          Op de lijst
        </button>
      </div>
    </form>
  );
}
