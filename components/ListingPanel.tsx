"use client";

import { useState } from "react";
import { classifyRooms } from "@/lib/ai";
import { ROOMS, roomLabel } from "@/lib/categories";
import { fileToDataUrl, proxied } from "@/lib/images";
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

  const setPhotos = (fn: (photos: Photo[]) => Photo[], title?: string) =>
    update((p) => ({
      ...p,
      listing: {
        url: p.listing?.url ?? url,
        title: title ?? p.listing?.title ?? "Mijn nieuwe huis",
        photos: fn(p.listing?.photos ?? []),
      },
    }));

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
      update((p) => ({
        ...p,
        listing: {
          url,
          title: data.title || "Mijn nieuwe huis",
          photos: data.photos.map((u) => ({ id: newId(), url: u, room: "overig" as RoomType })),
        },
        scenes: {},
      }));
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
          <button className="primary" disabled={busy}>
            {busy ? "Ophalen…" : "Ophalen"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}

        <details open={!!error}>
          <summary>Lukt ophalen niet? Twee alternatieven</summary>
          <ol className="fallback">
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
          <button className="primary" onClick={autoSort} disabled={!!aiStatus}>
            {aiStatus || "✨ Sorteer per ruimte met AI"}
          </button>
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
        Tip: sleep foto&apos;s naar de juiste ruimte. De AI draait gratis in je eigen browser (CLIP-model, eenmalig ±90 MB).
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proxied(photo.url)} alt={roomLabel(photo.room)} loading="lazy" />
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
                      onClick={() => setPhotos((photos) => photos.filter((p) => p.id !== photo.id))}
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
