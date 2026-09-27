"use client";

import { useState } from "react";
import { roomLabel } from "@/lib/categories";
import { fileToDataUrl } from "@/lib/images";
import { newId } from "@/lib/rooms";
import type { HouseFacts, Photo, RoomType } from "@/lib/types";
import { useApp } from "./app";
import { ArrowSquareOut, Plus } from "@phosphor-icons/react";
import { RoomDetect } from "./RoomDetect";
import { I, RoomIcon } from "./icons";
import { Img } from "./Img";
import { Lightbox } from "./ui";

const FACTS: [keyof HouseFacts, string][] = [
  ["price", "Vraagprijs"],
  ["livingArea", "Wonen"],
  ["plotArea", "Perceel"],
  ["rooms", "Kamers"],
  ["bathrooms", "Badkamers"],
  ["stories", "Woonlagen"],
  ["buildYear", "Bouwjaar"],
  ["energyLabel", "Energielabel"],
  ["kind", "Soort"],
];

/** Cover photo, address and key facts. */
export function HouseHero() {
  const { project } = useApp();
  const l = project.listing;
  const cover = l?.photos.find((p) => p.room === "buitenkant") ?? l?.photos.find((p) => p.room !== "plattegrond");
  const f = l?.facts ?? {};
  const chips = [f.livingArea, f.bedrooms && `${f.bedrooms} slaapkamers`, f.energyLabel && `Label ${f.energyLabel}`, f.buildYear && `Bouwjaar ${f.buildYear}`].filter(Boolean);
  return (
    <div className="hero">
      {cover && <Img className="cover" src={cover.url} width={1440} alt="" />}
      <div className="content">
        <span className="eyebrow">Ons nieuwe huis{f.neighborhood ? ` · ${f.neighborhood}` : ""}</span>
        <h1>{l?.title || "Ons nieuwe huis"}</h1>
        {chips.length > 0 && (
          <div className="facts">
            {chips.map((c) => (
              <span className="fact" key={c}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function HouseView() {
  const { project, update } = useApp();
  const l = project.listing;
  const [lightbox, setLightbox] = useState<{ list: string[]; i: number } | null>(null);
  const photos = l?.photos ?? [];
  const plans = photos.filter((p) => p.room === "plattegrond");
  const others = photos.filter((p) => p.room !== "plattegrond");

  const setPhoto = (id: string, patch: Partial<Photo>) =>
    update((p) => ({ ...p, listing: p.listing && { ...p.listing, photos: p.listing.photos.map((ph) => (ph.id === id ? { ...ph, ...patch } : ph)) } }));

  const byRoom = [
    ...project.rooms.map((r) => ({ key: r.id, label: r.name, type: r.type, photos: others.filter((p) => p.roomId === r.id) })),
    { key: "", label: "Overige foto's", type: "overig" as RoomType, photos: others.filter((p) => !p.roomId || !project.rooms.some((r) => r.id === p.roomId)) },
  ].filter((g) => g.photos.length);

  return (
    <section className="page">
      <HouseHero />

      <RoomDetect />

      {l?.facts && Object.keys(l.facts).length > 0 && (
        <div className="card stack">
          <h2>Kenmerken</h2>
          <div className="grid stats">
            {FACTS.filter(([k]) => l.facts?.[k]).map(([k, label]) => (
              <div key={k} className="stack tight">
                <span className="tiny muted">{label}</span>
                <strong>{l.facts![k]}</strong>
              </div>
            ))}
          </div>
          {l.url && (
            <a className="small" href={l.url} target="_blank" rel="noreferrer">
              Bekijk op Funda <I icon={ArrowSquareOut} size={14} />
            </a>
          )}
        </div>
      )}

      {l?.description && (
        <details className="card">
          <summary>Omschrijving van de makelaar</summary>
          <p className="small" style={{ whiteSpace: "pre-line" }}>
            {l.description}
          </p>
        </details>
      )}

      {plans.length > 0 && (
        <div className="stack">
          <h2>Plattegrond</h2>
          <div className="grid two">
            {plans.map((p, i) => (
              <div key={p.id} className="card flat" style={{ padding: 8, background: "#fff" }}>
                <button style={{ padding: 0, border: 0, width: "100%", background: "transparent", cursor: "zoom-in" }} onClick={() => setLightbox({ list: plans.map((x) => x.url), i })} aria-label="Plattegrond vergroten">
                  <Img src={p.url} width={1200} alt="Plattegrond" loading="lazy" style={{ width: "100%" }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stack">
        <div className="section-head">
          <div className="stack tight">
            <h2>Foto&apos;s per kamer</h2>
            <p className="small muted">Staat een foto bij de verkeerde kamer? Kies de goede onder de foto.</p>
          </div>
          <label className="btn">
            <I icon={Plus} /> Foto&apos;s
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (e) => {
                const files = [...(e.target.files ?? [])];
                const urls = await Promise.all(files.map((f) => fileToDataUrl(f)));
                update((p) => ({
                  ...p,
                  listing: {
                    ...(p.listing ?? { url: "", title: "Ons nieuwe huis", photos: [] }),
                    photos: [...(p.listing?.photos ?? []), ...urls.map((url) => ({ id: newId(), url, room: "overig" as const }))],
                  },
                }));
              }}
            />
          </label>
        </div>
        {byRoom.map((g) => (
          <div className="stack tight" key={g.key || "rest"}>
            <span className="eyebrow row" style={{ gap: 8 }}>
              <RoomIcon type={g.type} size={16} /> {g.label}
            </span>
            <div className="photo-grid">
              {g.photos.map((p) => (
                <div className="photo-tile" key={p.id}>
                  <button onClick={() => setLightbox({ list: g.photos.map((x) => x.url), i: g.photos.indexOf(p) })} aria-label="Foto vergroten">
                    <Img src={p.url} width={480} alt="" loading="lazy" />
                  </button>
                  <select
                    value={p.roomId ?? (p.room === "plattegrond" ? "plan" : p.room === "buitenkant" ? "out" : "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "plan") setPhoto(p.id, { room: "plattegrond", roomId: undefined });
                      else if (v === "out") setPhoto(p.id, { room: "buitenkant", roomId: undefined });
                      else {
                        const room = project.rooms.find((r) => r.id === v);
                        setPhoto(p.id, { roomId: v || undefined, room: room?.type ?? "overig" });
                      }
                    }}
                    aria-label="Kamer van deze foto"
                  >
                    <option value="">— geen kamer —</option>
                    {project.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                    <option value="out">{roomLabel("buitenkant")}</option>
                    <option value="plan">{roomLabel("plattegrond")}</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {lightbox && <Lightbox photos={lightbox.list} index={lightbox.i} onClose={() => setLightbox(null)} />}
    </section>
  );
}
