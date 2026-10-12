"use client";

import { useEffect, useState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
interface StatusResponse {
  ok: boolean;
  checks: Check[];
  checked_at: string;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="wrap" style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-6)", maxWidth: 560 }}>
      <h1>Status</h1>
      {error && <p className="error">Status kon niet geladen worden.</p>}
      {!data && !error && <p className="muted">Laden…</p>}
      {data && (
        <div className="stack">
          <p className={data.ok ? "small" : "small error"}>
            {data.ok ? "Alles werkt zoals verwacht." : "Er is iets dat aandacht nodig heeft — zie hieronder."}
          </p>
          <div className="stack tight">
            {data.checks.map((c) => (
              <div key={c.name} className="row" style={{ gap: 10 }}>
                {c.ok ? <CheckCircle size={20} weight="fill" color="var(--ok)" /> : <WarningCircle size={20} weight="fill" color="var(--danger)" />}
                <span className="grow">{c.name}</span>
                {c.detail && <span className="tiny muted">{c.detail}</span>}
              </div>
            ))}
          </div>
          <p className="tiny muted">Laatst gecontroleerd: {new Date(data.checked_at).toLocaleString("nl-NL")}</p>
        </div>
      )}
    </main>
  );
}
