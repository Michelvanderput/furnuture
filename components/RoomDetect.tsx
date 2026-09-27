"use client";

import { Sparkle, X } from "@phosphor-icons/react";
import { useState } from "react";
import { aiRooms, applyRooms, type RoomProposal } from "@/lib/ai";
import { euroCents, FAL_COST } from "@/lib/fal";
import { useApp } from "./app";
import { I, RoomIcon } from "./icons";

/** Rooms made by the AI carry a floor or an area; the first layout from Funda's facts has neither. */
export const roomsRecognised = (rooms: { floor?: string; area?: number }[]) => rooms.some((r) => r.floor || r.area);

/**
 * ✨ Rooms from the floor plan, the description and the photos, shown as a proposal
 * first. `compact`: the dashboard's version, which can be dismissed and hides once done.
 */
export function RoomDetect({ compact }: { compact?: boolean }) {
  const { project, update, fal, toast } = useApp();
  const l = project.listing;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<RoomProposal | null>(null);
  const [hidden, setHidden] = useState(false);
  if (!fal || !l || !l.photos.length) return null;
  if (compact && (hidden || (roomsRecognised(project.rooms) && !proposal))) return null;

  async function detect() {
    setError("");
    setBusy("Foto's en plattegrond bekijken…");
    try {
      setProposal(await aiRooms(l!, (m) => m && setBusy(m.includes("bezig") ? `Foto's en plattegrond bekijken… ${m.match(/\d+ s/)?.[0] ?? ""}` : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card ai-card stack">
      <div className="card-head">
        <div className="title" style={{ alignItems: "flex-start" }}>
          <span className="icon-badge accent">
            <I icon={Sparkle} size={20} />
          </span>
          <div className="stack tight" style={{ maxWidth: 560 }}>
            <h3>{compact ? "Laat de AI je kamers indelen" : "Kamers herkennen"}</h3>
            <p className="small muted">
              {compact
                ? `We hebben ${project.rooms.length} kamers gemaakt uit de Funda-gegevens. De AI leest de plattegrond en de foto's voor de echte indeling: namen, m², verdieping en welke foto bij welke kamer hoort.`
                : "De AI leest de plattegrond, de omschrijving en alle foto's: welke kamers, hoe groot, op welke verdieping, en welke foto bij welke kamer hoort."}
            </p>
          </div>
        </div>
        <div className="row">
          <button className="accent" onClick={detect} disabled={!!busy} aria-live="polite">
            {busy ? (
              <>
                <span className="spinner" /> {busy}
              </>
            ) : (
              <>
                <I icon={Sparkle} /> {proposal ? "Opnieuw" : "Herken kamers"} <span className="cost">{euroCents(FAL_COST.rooms)}</span>
              </>
            )}
          </button>
          {compact && !busy && (
            <button className="ghost icon" onClick={() => setHidden(true)} aria-label="Niet nu">
              <I icon={X} />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <div className="stack">
          <div className="grid two" style={{ gap: 8 }}>
            {proposal.rooms.map((r) => (
              <div key={r.id} className="suggestion">
                <span className="icon-badge">
                  <RoomIcon type={r.type} size={20} />
                </span>
                <div className="grow stack tight">
                  <strong className="small">{r.name}</strong>
                  <span className="tiny muted">
                    {[r.floor, r.area && `${r.area} m²`, r.photoIdx.length ? `${r.photoIdx.length} ${r.photoIdx.length === 1 ? "foto" : "foto's"}` : ""].filter(Boolean).join(" · ")}
                    {r.note ? ` — ${r.note}` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="row wrap-row between">
            <span className="tiny muted">Kamers van dezelfde soort houden hun producten en budget. Daarna is alles nog aan te passen.</span>
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
                  toast(`${proposal.rooms.length} kamers ingedeeld`, () => update(() => before));
                }}
              >
                Toepassen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
