"use client";

import { useEffect, useRef, useState } from "react";
import { fileToDataUrl } from "@/lib/images";
import type { FundaResult } from "@/lib/types";
import { PasteButton } from "./PasteButton";

/** Loads a house from Funda (via our server, or the fallbacks when Funda blocks that). */
export async function fetchFunda(url: string, html?: string): Promise<FundaResult> {
  const res = await fetch("/api/funda", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(html ? { url, html } : { url }),
  });
  const data = (await res.json().catch(() => ({}))) as FundaResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Ophalen mislukt");
  if (!data.photos?.length) throw new Error("Geen foto's gevonden op deze pagina.");
  return data;
}

export function Welcome({ onImport, onBlank }: { onImport: (url: string, data: FundaResult) => void; onBlank: (name: string, photos: string[]) => void }) {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(withHtml = false) {
    setBusy(true);
    setError("");
    try {
      onImport(url, await fetchFunda(url, withHtml ? html : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="welcome">
      <div className="panel">
        <div className="brand">
          <span className="logo">⌂</span>
          <span>
            furn<b>u</b>ture
          </span>
        </div>
        <div className="stack">
          <h1>
            Van sleutel tot <em>thuis</em>: alles wat je nodig hebt, per kamer.
          </h1>
          <p className="muted" style={{ fontSize: 17 }}>
            Plak de Funda-link van je nieuwe huis. Wij maken de kamers aan, jij verzamelt per kamer wat je wilt kopen — met prijzen, budget en een
            overzicht per winkel.
          </p>
        </div>
        <form
          className="url-bar"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input type="url" required placeholder="https://www.funda.nl/detail/koop/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Funda-link" />
          <PasteButton label="Plak" onPaste={(t) => setUrl(t.match(/https?:\/\/\S+/)?.[0] ?? t)} />
          <button className="primary" disabled={busy}>
            {busy ? <span className="spinner" /> : "Start →"}
          </button>
        </form>
        {error && <p className="error small">{error}</p>}
        <div className="features">
          <div>
            <b>🏡 Kamers uit Funda</b>Foto&apos;s, m² en indeling van je nieuwe huis.
          </div>
          <div>
            <b>🛒 Lijst per kamer</b>Plak een link uit elke webshop: foto, prijs en maten komen vanzelf.
          </div>
          <div>
            <b>💶 Budget in beeld</b>Totaal per kamer, per winkel en wat al besteld is.
          </div>
          <div>
            <b>✨ Slimme hulp</b>AI herkent je kamers en tipt wat je nog mist.
          </div>
        </div>
        <details open={!!error}>
          <summary>Lukt het niet, of geen Funda-link?</summary>
          <div className="stack">
            <p className="small">
              <strong>Via je browser:</strong> sleep <FundaBookmarklet /> naar je bladwijzerbalk, open de woning op Funda en klik erop.
            </p>
            <div className="stack tight">
              <p className="small">
                <strong>Paginabron:</strong> open de woning op Funda, <kbd>Ctrl</kbd>+<kbd>U</kbd>, alles kopiëren en hier plakken:
              </p>
              <textarea rows={3} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<!DOCTYPE html>…" />
              <div>
                <button disabled={!html || busy} onClick={() => load(true)}>
                  Uit paginabron halen
                </button>
              </div>
            </div>
            <BlankStart onBlank={onBlank} />
          </div>
        </details>
      </div>
    </div>
  );
}

function BlankStart({ onBlank }: { onBlank: (name: string, photos: string[]) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack tight">
      <p className="small">
        <strong>Zonder Funda:</strong> geef je huis een naam (foto&apos;s toevoegen mag, hoeft niet).
      </p>
      <div className="row">
        <input placeholder="Bijv. Ons nieuwe huis" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="btn">
          {busy ? <span className="spinner" /> : "📷"}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              if (!files.length) return;
              setBusy(true);
              const photos = await Promise.all(files.map((f) => fileToDataUrl(f)));
              setBusy(false);
              onBlank(name || "Ons nieuwe huis", photos);
            }}
          />
        </label>
        <button className="primary" onClick={() => onBlank(name || "Ons nieuwe huis", [])}>
          Begin
        </button>
      </div>
    </div>
  );
}

/**
 * A bookmarklet runs on funda.nl in the user's own browser, so Funda's bot protection
 * does not apply. It collects the photo URLs (also from the /media/foto/ page) and
 * opens this app with them in the URL hash (#import=…, read in app/page.tsx).
 */
function FundaBookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const code = `(async()=>{const A=${JSON.stringify(window.location.origin)};const re=/https?:\\/\\/cloud\\.funda\\.nl\\/valentina_media\\/[0-9\\/_x]+\\.(?:jpe?g|png|webp)/g;let h=document.documentElement.innerHTML;try{const u=location.href.split(/[?#]/)[0].replace(/\\/?$/,"/").replace(/media\\/foto\\/$/,"")+"media/foto/";h+=await(await fetch(u)).text()}catch(e){}const p=[...new Set(h.replace(/\\\\\\//g,"/").match(re)||[])];if(!p.length){alert("Geen foto's gevonden. Open eerst een woning op funda.nl.");return}location.href=A+"/#import="+encodeURIComponent(JSON.stringify({u:location.href,t:document.title,p}))})()`;
    // React refuses javascript: URLs in JSX, so set it directly.
    ref.current?.setAttribute("href", `javascript:${encodeURIComponent(code)}`);
  }, []);
  return (
    <a
      ref={ref}
      className="chip accent"
      onClick={(e) => {
        e.preventDefault();
        alert("Sleep deze knop naar je bladwijzerbalk en klik erop als je op een Funda-woning bent.");
      }}
    >
      📸 Naar furnuture
    </a>
  );
}
