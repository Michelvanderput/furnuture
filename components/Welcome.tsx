"use client";

import { useEffect, useRef, useState } from "react";
import { fileToDataUrl } from "@/lib/images";
import type { FundaResult } from "@/lib/types";
import { ArrowLeft, ArrowRight, Camera, Hammer, HouseLine, ListChecks, Wallet, type Icon } from "@phosphor-icons/react";
import { Armchair, I } from "./icons";
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

/** The house's name is known but it has no house yet: load it from Funda, or start without. */
export function Welcome({
  name,
  onImport,
  onBlank,
  onBack,
  children,
}: {
  name: string;
  onImport: (url: string, data: FundaResult) => void | Promise<void>;
  onBlank: (photos: string[]) => void | Promise<void>;
  onBack?: () => void;
  /** Other ways to start (a house from the bookmarklet, what is already on this device). */
  children?: React.ReactNode;
}) {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(withHtml = false) {
    setBusy(true);
    setError("");
    try {
      await onImport(url, await fetchFunda(url, withHtml ? html : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WelcomeLayout>
        {onBack && (
          <button className="back ghost" onClick={onBack} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
            <I icon={ArrowLeft} /> Andere naam
          </button>
        )}
        <div className="stack" style={{ gap: 16 }}>
          <h1>
            Welkom, <em>{name}</em>.
          </h1>
          <p className="intro">
            Deze woning is nieuw. Plak de Funda-link: wij maken de kamers aan, jij verzamelt per kamer wat je gaat kopen en wat er verbouwd moet worden.
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
          <button className="accent" disabled={busy}>
            {busy ? <span className="spinner" /> : <>Start <I icon={ArrowRight} weight="bold" /></>}
          </button>
        </form>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        {children}
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
    </WelcomeLayout>
  );
}

/** The welcome screens' frame: brand and content on the left, an interior photo on the right. */
export function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="welcome">
      <main className="panel">
        <div className="brand">
          <span className="logo">
            <I icon={Armchair} size={20} weight="bold" />
          </span>
          <span>
            furn<em>u</em>ture
          </span>
        </div>
        {children}
      </main>
      <div className="art" style={{ backgroundImage: `url(${ART})` }} aria-hidden />
    </div>
  );
}

export function Features() {
  return (
    <div className="features">
      {FEATURES.map((f) => (
        <div className="feature" key={f.title}>
          <span className="icon-badge">
            <I icon={f.icon} size={20} />
          </span>
          <span>
            <strong>{f.title}</strong>
            {f.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Interior photo for the welcome screen (Unsplash, free to use). */
const ART = "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=75";

const FEATURES: { icon: Icon; title: string; text: string }[] = [
  { icon: HouseLine, title: "Kamers uit Funda", text: "Foto's, m² en indeling; AI herkent de kamers." },
  { icon: ListChecks, title: "Lijst per kamer", text: "Plak een link uit elke webshop: foto, prijs en maten komen vanzelf." },
  { icon: Hammer, title: "Verbouwing gepland", text: "Klussen, offertes en een planning tot de verhuisdag." },
  { icon: Wallet, title: "Budget in beeld", text: "Inrichting en verbouwing samen, per kamer en per winkel." },
];

function BlankStart({ onBlank }: { onBlank: (photos: string[]) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const go = async (photos: string[]) => {
    setBusy(true);
    try {
      await onBlank(photos);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack tight">
      <p className="small">
        <strong>Zonder Funda:</strong> begin leeg en voeg zelf kamers toe (foto&apos;s erbij mag, hoeft niet).
      </p>
      <div className="row wrap-row">
        <button className="primary" disabled={busy} onClick={() => go([])}>
          {busy ? <span className="spinner" /> : "Leeg beginnen"}
        </button>
        <label className="btn">
          <I icon={Camera} /> Met foto&apos;s
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={busy}
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              if (!files.length) return;
              setBusy(true);
              go(await Promise.all(files.map((f) => fileToDataUrl(f))));
            }}
          />
        </label>
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
      <I icon={Armchair} size={14} /> Naar furnuture
    </a>
  );
}
