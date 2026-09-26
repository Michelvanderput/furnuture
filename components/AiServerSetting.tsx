"use client";

import { useEffect, useState } from "react";
import { cloudHealth, cloudUrl, normalize, setCloudUrl } from "@/lib/cloud";

/**
 * Project menu: the address of your own (free) AI server, a Hugging Face Space
 * made from the ai-server folder of this project. With it, the AI runs there
 * instead of on the iPad.
 */
export function AiServerSetting({ onChange }: { onChange?: (on: boolean) => void }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const url = cloudUrl();
    setActive(url);
    setValue(url ?? "");
  }, []);

  async function save(url: string | null) {
    setCloudUrl(url);
    const now = cloudUrl();
    setActive(now);
    setValue(now ?? "");
    onChange?.(!!now);
    if (!now) return setStatus(url === null ? "AI-server uit: de AI draait op dit apparaat." : "");
    setStatus("Verbinden… (een slapende Space heeft soms een minuut nodig)");
    try {
      const info = await cloudHealth();
      setStatus(info.ok ? "✅ Verbonden: de AI draait nu op je server." : "De server antwoordt, maar is nog niet klaar.");
    } catch (e) {
      setStatus(`Nog niet bereikbaar (${e instanceof Error ? e.message : e}). Probeer het over een minuut opnieuw.`);
    }
  }

  return (
    <div className="stack small">
      <label className="stack" title="Je eigen gratis Hugging Face Space (map ai-server in dit project)">
        <span>
          ☁️ AI-server <span className="muted">(gratis, geen AI meer op de iPad)</span>
        </span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://jouwnaam-furnuture-ai.hf.space"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <div className="row wrap">
        <button className="small" onClick={() => save(value ? normalize(value) : "")} disabled={!value.trim()}>
          Opslaan &amp; testen
        </button>
        {active && (
          <button className="small ghost" onClick={() => save(null)}>
            Uitzetten
          </button>
        )}
      </div>
      {status && <p className="small">{status}</p>}
      {!active && !status && (
        <p className="muted small">
          Maak op huggingface.co gratis een Space (type Docker) en zet daar de bestanden uit de map <code>ai-server</code> in. Plak dan hier
          de link van de Space.
        </p>
      )}
    </div>
  );
}
