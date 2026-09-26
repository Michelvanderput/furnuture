"use client";

import { useEffect, useRef, useState } from "react";
import { classifyRooms } from "@/lib/ai";
import { ROOMS, roomLabel } from "@/lib/categories";
import { extractFundaPhotos } from "@/lib/extract";
import { fileToDataUrl } from "@/lib/images";
import { Img } from "./Img";
import { PasteButton } from "./PasteButton";
import { newId } from "@/lib/useProject";
import type { FundaResult, Photo, Project, RoomType } from "@/lib/types";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  onDecorate: (photoId: string) => void;
}

export function ListingPanel({ project, update, onDecorate }: Props) {
  const listing = project.listing;
  const [url, setUrl] = useState(listing?.url ?? "");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  /** A freshly loaded house is sorted per room right away: one step less. */
  const [sortSoon, setSortSoon] = useState(false);

  const setPhotos = (fn: (photos: Photo[]) => Photo[], title?: string) =>
    update((p) => ({
      ...p,
      listing: {
        url: p.listing?.url ?? url,
        title: title ?? p.listing?.title ?? "Mijn nieuwe huis",
        photos: fn(p.listing?.photos ?? []),
      },
    }));

  const loadResult = (listingUrl: string, data: FundaResult) => {
    if (data.photos.some((u) => !data.rooms?.[u])) setSortSoon(true);
    update((p) => ({
      ...p,
      listing: {
        url: listingUrl,
        title: data.title || "Mijn nieuwe huis",
        photos: data.photos.map((u) => ({ id: newId(), url: u, room: data.rooms?.[u] ?? ("overig" as RoomType) })),
      },
      scenes: {},
    }));
  };

  useEffect(() => {
    if (!sortSoon || !listing?.photos.length) return;
    setSortSoon(false);
    autoSort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortSoon, listing]);

  // Photos sent by the bookmarklet arrive as #import={u,t,p} (see FundaBookmarklet).
  useEffect(() => {
    if (!window.location.hash.startsWith("#import=")) return;
    try {
      const data = JSON.parse(decodeURIComponent(window.location.hash.slice(8))) as { u: string; t: string; p: string[] };
      const photos = extractFundaPhotos(data.p.join(" "));
      if (photos.length) {
        setUrl(data.u);
        loadResult(data.u, { title: data.t.replace(/\s*[|\-[]\s*funda.*$/i, "").replace(/^[^:]{0,30}:\s*/, "").trim(), photos });
      }
    } catch {
      setError("Importeren vanaf Funda mislukt.");
    }
    history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importListing(withHtml: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/funda", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withHtml ? { url, html } : { url }),
      });
      const data = (await res.json()) as FundaResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ophalen mislukt");
      if (data.photos.length === 0) throw new Error("Geen foto's gevonden in deze pagina.");
      loadResult(url, data);
      setHtml("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const urls = await Promise.all([...files].map((f) => fileToDataUrl(f)));
    setPhotos((photos) => [...photos, ...urls.map((u) => ({ id: newId(), url: u, room: "overig" as RoomType }))]);
  }

  const moveTo = (id: string, room: RoomType) =>
    setPhotos((photos) => photos.map((ph) => (ph.id === id ? { ...ph, room } : ph)));

  async function autoSort() {
    if (!listing) return;
    setError("");
    try {
      await classifyRooms(listing.photos, moveTo, setAiStatus);
    } catch (e) {
      setAiStatus("");
      setError(`AI-sortering mislukt: ${e instanceof Error ? e.message : e}. Sleep de foto's handmatig.`);
    }
  }

  if (!listing) {
    return (
      <section className="panel narrow">
        <h2>1. Plak de Funda-link van je nieuwe huis</h2>
        <p className="muted">We halen alle foto&apos;s op en sorteren ze per ruimte.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            importListing(false);
          }}
        >
          <input
            type="url"
            required
            placeholder="https://www.funda.nl/detail/koop/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <PasteButton onPaste={(t) => setUrl(t.match(/https?:\/\/\S+/)?.[0] ?? t)} />
          <button className="primary" disabled={busy}>
            {busy ? "Ophalen…" : "Ophalen"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}

        <details open={!!error}>
          <summary>Lukt ophalen niet? Drie alternatieven</summary>
          <ol className="fallback">
            <li>
              <strong>Via je browser (aanrader op de computer):</strong> sleep deze knop naar je bladwijzerbalk{" "}
              <FundaBookmarklet /> . Open daarna de woning op Funda en klik op de bladwijzer: de foto&apos;s komen
              vanzelf hierheen.
            </li>
            <li>
              Open de woning op Funda, druk op <kbd>Ctrl</kbd>+<kbd>U</kbd> (bron weergeven), selecteer alles en plak het
              hier:
              <textarea rows={4} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<!DOCTYPE html>…" />
              <button disabled={!html || busy} onClick={() => importListing(true)}>
                Foto&apos;s uit paginabron halen
              </button>
            </li>
            <li>
              Of upload de foto&apos;s zelf:{" "}
              <input type="file" accept="image/*" multiple onChange={(e) => upload(e.target.files)} />
            </li>
          </ol>
        </details>
      </section>
    );
  }

  const byRoom = ROOMS.map((r) => ({ ...r, photos: listing.photos.filter((p) => p.room === r.id) }));

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{listing.title}</h2>
          <p className="muted">
            {listing.photos.length} foto&apos;s ·{" "}
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noreferrer">
                bekijk op Funda
              </a>
            )}
          </p>
        </div>
        <div className="row wrap">
          {(() => {
            const sorted = listing.photos.every((p) => p.room !== "overig");
            return (
              <button className={sorted && !aiStatus ? "" : "primary"} onClick={autoSort} disabled={!!aiStatus}>
                {aiStatus || (sorted ? "✨ Opnieuw sorteren" : "✨ Sorteer per ruimte met AI")}
              </button>
            );
          })()}
          <label className="button">
            Foto&apos;s toevoegen
            <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          </label>
          <button
            onClick={() => {
              if (confirm("Andere woning laden? Je indeling en visualisaties van deze woning worden gewist.")) {
                update((p) => ({ ...p, listing: null, scenes: {} }));
              }
            }}
          >
            Andere woning
          </button>
        </div>
      </header>
      <p className="muted small">
        De foto&apos;s worden vanzelf per ruimte gesorteerd. Klopt er een niet? Kies de ruimte onder de foto of sleep hem naar de juiste
        groep.
      </p>
      {error && <p className="error">{error}</p>}

      {byRoom
        .filter((r) => r.photos.length > 0 || dragId)
        .map((room) => (
          <div
            key={room.id}
            className={`room ${dragId ? "droppable" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) moveTo(dragId, room.id);
              setDragId(null);
            }}
          >
            <h3>
              {room.label} <span className="count">{room.photos.length}</span>
            </h3>
            <div className="grid photos">
              {room.photos.map((photo) => (
                <figure
                  key={photo.id}
                  draggable
                  onDragStart={() => setDragId(photo.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <Img src={photo.url} width={480} alt={roomLabel(photo.room)} loading="lazy" />
                  <figcaption>
                    <select value={photo.room} onChange={(e) => moveTo(photo.id, e.target.value as RoomType)}>
                      {ROOMS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button className="small" onClick={() => onDecorate(photo.id)} title="Inrichten">
                      🛋️ Inrichten
                    </button>
                    <button
                      className="small ghost"
                      title="Verwijderen"
                      onClick={() =>
                        update((p) => {
                          // Also drop the design made on this photo.
                          const scenes = { ...p.scenes };
                          delete scenes[photo.id];
                          return { ...p, scenes, listing: p.listing && { ...p.listing, photos: p.listing.photos.filter((x) => x.id !== photo.id) } };
                        })
                      }
                    >
                      ✕
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}

/**
 * A bookmarklet runs on funda.nl in the user's own browser, so Funda's bot protection
 * does not apply. It collects the photo URLs (also from the /media/foto/ page) and
 * opens this app with them in the URL hash.
 */
function FundaBookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const code = `(async()=>{const A=${JSON.stringify(window.location.origin)};const re=/https?:\\/\\/cloud\\.funda\\.nl\\/valentina_media\\/[0-9\\/_x]+\\.(?:jpe?g|png|webp)/g;let h=document.documentElement.innerHTML;try{const u=location.href.split(/[?#]/)[0].replace(/\\/?$/,"/").replace(/media\\/foto\\/$/,"")+"media/foto/";h+=await(await fetch(u)).text()}catch(e){}const p=[...new Set(h.replace(/\\\\\\//g,"/").match(re)||[])];if(!p.length){alert("Geen foto's gevonden. Open eerst een woning op funda.nl.");return}location.href=A+"/#import="+encodeURIComponent(JSON.stringify({u:location.href,t:document.title,p}))})()`;
    // React refuses javascript: URLs in JSX, so set it directly.
    ref.current?.setAttribute("href", `javascript:${encodeURIComponent(code)}`);
  }, []);
  return (
    <a ref={ref} className="button bookmarklet" onClick={(e) => { e.preventDefault(); alert("Sleep deze knop naar je bladwijzerbalk en klik erop als je op een Funda-woning bent."); }}>
      📸 Foto&apos;s van Funda halen
    </a>
  );
}
