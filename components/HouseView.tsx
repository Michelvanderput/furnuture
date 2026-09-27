"use client";

import { useState } from "react";
import { aiRooms, applyRooms, type RoomProposal } from "@/lib/ai";
import { roomLabel } from "@/lib/categories";
import { euroCents, FAL_COST } from "@/lib/fal";
import { fileToDataUrl } from "@/lib/images";
import { newId, ROOM_EMOJI } from "@/lib/rooms";
import type { HouseFacts, Photo } from "@/lib/types";
import { useApp } from "./app";
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
      <div className="shade" />
      <div className="content">
        <span className="eyebrow" style={{ color: "rgba(255,255,255,0.85)" }}>
          Ons nieuwe huis{f.neighborhood ? ` · ${f.neighborhood}` : ""}
        </span>
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
  const { project, update, fal, toast } = useApp();
  const l = project.listing;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<RoomProposal | null>(null);
  const [lightbox, setLightbox] = useState<{ list: string[]; i: number } | null>(null);
  const photos = l?.photos ?? [];
  const plans = photos.filter((p) => p.room === "plattegrond");
  const others = photos.filter((p) => p.room !== "plattegrond");

  async function detect() {
    if (!l) return;
    setError("");
    setBusy("…");
    try {
      setProposal(await aiRooms(l, (m) => setBusy(m || "…")));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const setPhoto = (id: string, patch: Partial<Photo>) =>
    update((p) => ({ ...p, listing: p.listing && { ...p.listing, photos: p.listing.photos.map((ph) => (ph.id === id ? { ...ph, ...patch } : ph)) } }));

  const byRoom = [
    ...project.rooms.map((r) => ({ key: r.id, label: `${ROOM_EMOJI[r.type]} ${r.name}`, photos: others.filter((p) => p.roomId === r.id) })),
    { key: "", label: "Overige foto's", photos: others.filter((p) => !p.roomId || !project.rooms.some((r) => r.id === p.roomId)) },
  ].filter((g) => g.photos.length);

  return (
    <section className="page">
      <HouseHero />

      {fal && l && (
        <div className="card ai-card stack">
          <div className="section-head">
            <div className="stack tight">
              <h3>✨ Kamers herkennen</h3>
              <p className="small muted">
                De AI leest de plattegrond, de omschrijving en alle foto&apos;s: welke kamers, hoe groot, op welke verdieping, en welke foto bij welke kamer
                hoort.
              </p>
            </div>
            <button className="ai" onClick={detect} disabled={!!busy}>
              {busy ? (
                <>
                  <span className="spinner" /> Bezig…
                </>
              ) : (
                <>
                  ✨ Herken kamers <span className="tiny">({euroCents(FAL_COST.rooms)})</span>
                </>
              )}
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
          {proposal && (
            <div className="stack">
              <div className="grid two" style={{ gap: 8 }}>
                {proposal.rooms.map((r) => (
                  <div key={r.id} className="suggestion">
                    <span className="emoji" style={{ background: "var(--accent-tint)" }}>
                      {ROOM_EMOJI[r.type]}
                    </span>
                    <div className="grow stack tight">
                      <strong className="small">{r.name}</strong>
                      <span className="tiny muted">
                        {[r.floor, r.area && `${r.area} m²`, `${r.photoIdx.length} foto's`].filter(Boolean).join(" · ")}
                        {r.note ? ` · ${r.note}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row wrap-row between">
                <span className="tiny muted">Kamers van dezelfde soort houden hun producten en budget. Alles is daarna nog aan te passen.</span>
                <div className="row">
                  <button className="ghost" onClick={() => setProposal(null)}>
                    Niet doen
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      const before = project;
                      update((p) => applyRooms(p, proposal));
                      setProposal(null);
                      toast(`✓ ${proposal.rooms.length} kamers ingedeeld`, () => update(() => before));
                    }}
                  >
                    Toepassen
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {l?.facts && Object.keys(l.facts).length > 0 && (
        <div className="card stack">
          <h3>Kenmerken</h3>
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
              Bekijk op Funda ↗
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
          <h2>🗺️ Plattegrond</h2>
          <div className="grid two">
            {plans.map((p, i) => (
              <div key={p.id} className="card flat" style={{ padding: 8, background: "#fff" }}>
                <Img src={p.url} width={1200} alt="Plattegrond" loading="lazy" style={{ width: "100%", cursor: "zoom-in" }} onClick={() => setLightbox({ list: plans.map((x) => x.url), i })} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stack">
        <div className="section-head">
          <div className="stack tight">
            <h2>📷 Foto&apos;s per kamer</h2>
            <p className="small muted">Staat een foto bij de verkeerde kamer? Kies de goede onder de foto.</p>
          </div>
          <label className="btn">
            ＋ Foto&apos;s
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
            <span className="eyebrow">{g.label}</span>
            <div className="photo-grid">
              {g.photos.map((p) => (
                <div className="photo-tile" key={p.id}>
                  <Img src={p.url} width={480} alt="" loading="lazy" onClick={() => setLightbox({ list: g.photos.map((x) => x.url), i: g.photos.indexOf(p) })} />
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
