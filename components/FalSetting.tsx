"use client";

import { useEffect, useState } from "react";
import { accessCode, falEnabled, falInfo, setAccessCode } from "@/lib/fal";

/** Project menu: is fal.ai (the paid, best AI) set up, and the access code if the server asks for one. */
export function FalSetting() {
  const [info, setInfo] = useState<{ enabled: boolean; needsCode: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");

  const refresh = () => {
    falInfo().then(setInfo);
    falEnabled().then(setReady);
  };
  useEffect(() => {
    setCode(accessCode());
    refresh();
  }, []);

  if (!info) return null;
  return (
    <div className="stack small">
      <span>
        ✨ fal.ai{" "}
        {ready ? (
          <strong>actief</strong>
        ) : info.enabled ? (
          <span className="muted">— vul de toegangscode in</span>
        ) : (
          <span className="muted">— niet ingesteld</span>
        )}
      </span>
      {ready && (
        <span className="muted">
          Weggummen, selecteren en uitknippen gaan via fal (± 2 cent per keer weggummen); ✨ Fotorealistisch ± 11 cent.
        </span>
      )}
      {info.enabled && info.needsCode && (
        <div className="row">
          <input type="password" placeholder="Toegangscode" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <button
            className="small"
            onClick={() => {
              setAccessCode(code);
              refresh();
            }}
          >
            Opslaan
          </button>
        </div>
      )}
      {!info.enabled && (
        <span className="muted">
          De beste AI (betaald per gebruik): maak een sleutel op fal.ai en zet die in Vercel als <code>FAL_KEY</code>.
        </span>
      )}
    </div>
  );
}
