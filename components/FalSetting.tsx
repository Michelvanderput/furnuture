"use client";

import { useEffect, useState } from "react";
import { accessCode, dailyLimitEur, euros, falEnabled, falInfo, falStopped, setAccessCode, setDailyLimitEur, spentToday } from "@/lib/fal";

/** Project menu: is fal.ai (the paid, best AI) set up, what did it cost today, the daily limit and the access code. */
export function FalSetting() {
  const [info, setInfo] = useState<{ enabled: boolean; needsCode: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [limit, setLimit] = useState("");
  const [spent, setSpent] = useState(0);

  const refresh = () => {
    falInfo().then(setInfo);
    falEnabled().then(setReady);
    setSpent(spentToday());
  };
  useEffect(() => {
    setCode(accessCode());
    setLimit(String(dailyLimitEur()).replace(".", ","));
    refresh();
  }, []);

  if (!info) return null;
  const stopped = falStopped();
  return (
    <div className="stack small">
      <span>
        ✨ fal.ai{" "}
        {ready ? (
          <strong>actief</strong>
        ) : stopped ? (
          <span className="error">— gestopt</span>
        ) : info.enabled ? (
          <span className="muted">— vul de toegangscode in</span>
        ) : (
          <span className="muted">— niet ingesteld</span>
        )}
      </span>
      {stopped && <span className="error">{stopped}</span>}
      {info.enabled && (
        <>
          <span className="muted">
            Vandaag gebruikt: <strong>{euros(spent)}</strong> (schatting, dit apparaat). Weggummen ± 2 cent, vloer & muren of fotorealistisch ± 11 cent
            (wordt eerst gevraagd). Hetzelfde opnieuw is gratis.
          </span>
          <label className="row">
            Daglimiet €
            <input
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => {
                const v = Number(limit.replace(",", "."));
                if (v > 0) setDailyLimitEur(v);
                setLimit(String(dailyLimitEur()).replace(".", ","));
              }}
              style={{ width: 70 }}
            />
          </label>
        </>
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
