"use client";

import { useEffect, useState } from "react";
import { accessCode, dailyLimitEur, euros, falEnabled, falInfo, falStopped, setAccessCode, setDailyLimitEur, spentToday } from "@/lib/fal";

/** Settings: is fal.ai (the paid AI) set up, what did it cost today, the daily limit and the access code. */
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
        <strong>AI (fal.ai)</strong>{" "}
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
            Vandaag gebruikt: <strong>{euros(spent)}</strong> (dit apparaat). Een vraag aan de AI kost minder dan 1 tot ± 3 cent; dezelfde vraag
            opnieuw is gratis.
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
          Slimme hulp (kamers herkennen, tips per kamer, screenshots lezen, alternatieven zoeken) werkt met fal.ai: zet een sleutel in Vercel als{" "}
          <code>FAL_KEY</code>.
        </span>
      )}
    </div>
  );
}
