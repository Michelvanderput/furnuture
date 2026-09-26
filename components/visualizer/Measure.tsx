"use client";

import { useState } from "react";
import type { Pt } from "@/lib/types";

/** Length label on the photo: readable at any zoom, with a light background. */
export function MeasureLabel({ at, text, size }: { at: Pt; text: string; size: number }) {
  const fs = size / 55;
  const w = text.length * fs * 0.56 + fs;
  return (
    <g className="measure-label" transform={`translate(${at[0]} ${at[1]})`}>
      <rect x={-w / 2} y={-fs * 0.85} width={w} height={fs * 1.6} rx={fs * 0.4} />
      <text textAnchor="middle" dominantBaseline="middle" fontSize={fs} y={-fs * 0.05}>
        {text}
      </text>
    </g>
  );
}

/** After the first line on a floor: how long is it in reality? */
export function RulerPrompt({ onSave, onCancel, tip }: { onSave: (cm: number) => void; onCancel: () => void; tip?: string }) {
  const [value, setValue] = useState("");
  const cm = parseFloat(value.replace(",", "."));
  const valid = Number.isFinite(cm) && cm > 0;
  return (
    <form
      className="ruler-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(cm);
      }}
    >
      <strong>📏 Hoe lang is deze lijn in het echt?</strong>
      <div className="row wrap">
        <input autoFocus inputMode="decimal" placeholder="bv. 420" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Lengte in cm" />
        <span>cm</span>
        <button className="primary" disabled={!valid}>
          Opslaan
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Later
        </button>
      </div>
      <p className="muted small">
        {tip ??
          "Tip: neem een maat uit de plattegrond van Funda (bijvoorbeeld de breedte van de kamer, langs de voet van de muur) of een binnendeur: die is meestal 83 cm breed. Hoe langer de lijn, hoe nauwkeuriger."}
      </p>
    </form>
  );
}
