"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ListingPanel } from "@/components/ListingPanel";
import { backupBlob, backupFileName, readBackup } from "@/lib/backup";
import { shareOrDownload } from "@/lib/exportImage";
import { useProject } from "@/lib/useProject";
import { isLightMode, setLightMode, takeCrashReport } from "@/lib/worker";

// Loaded when the tab is first opened: a faster first start, especially on an iPad.
const ProductsPanel = dynamic(() => import("@/components/ProductsPanel").then((m) => m.ProductsPanel), {
  loading: () => <p className="empty">Laden…</p>,
});
const Visualizer = dynamic(() => import("@/components/Visualizer").then((m) => m.Visualizer), {
  loading: () => <p className="empty">Laden…</p>,
});

type Tab = "woning" | "producten" | "visualiseren";
const TABS: Tab[] = ["woning", "producten", "visualiseren"];

/** Per-device convenience only (which tab/photo was open); never required. */
function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage
  }
}
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function Home() {
  const { project, update, replace, loaded } = useProject();
  const [tab, setTab] = useState<Tab>("woning");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [menuMessage, setMenuMessage] = useState("");
  const [crashed, setCrashed] = useState<string | null>(null);
  const [light, setLight] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Did an AI job take the tab down last time (iPad out of memory)? Then use the light models.
  useEffect(() => {
    setCrashed(takeCrashReport());
    setLight(isLightMode());
  }, []);

  // Safari reloads background tabs; come back where you were.
  useEffect(() => {
    const t = recall("furnuture:tab") as Tab | null;
    if (t && TABS.includes(t)) setTab(t);
    setPhotoId(recall("furnuture:photo"));
  }, []);
  useEffect(() => remember("furnuture:tab", tab), [tab]);
  useEffect(() => remember("furnuture:photo", photoId), [photoId]);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "woning", label: "🏠 Woning", count: project.listing?.photos.length },
    { id: "producten", label: "🛋️ Producten", count: project.products.length },
    { id: "visualiseren", label: "🪄 Inrichten" },
  ];

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      const p = await readBackup(file);
      if (!confirm("Back-up terugzetten? Wat je nu hebt, wordt vervangen.")) return;
      replace(p);
      setMenuMessage("Back-up teruggezet.");
    } catch (e) {
      setMenuMessage(e instanceof Error ? e.message : "Terugzetten mislukt.");
    }
  }

  return (
    <main>
      <header className="app-head">
        <div className="brand-row">
          <div>
            <h1>
              furn<span>u</span>ture
            </h1>
            <p className="muted">Richt je nieuwe huis in terwijl je op de sleutel wacht.</p>
          </div>
          <details className="menu">
            <summary aria-label="Project-menu">⋯ Project</summary>
            <div className="menu-body">
              <button onClick={() => shareOrDownload(backupBlob(project), backupFileName(project))}>⬇ Back-up opslaan</button>
              <button onClick={() => fileRef.current?.click()}>⬆ Back-up terugzetten</button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => (restore(e.target.files?.[0]), (e.target.value = ""))}
              />
              <label className="row small" title="Kleinere AI-modellen: minder precies, maar zuiniger met geheugen (voor oudere iPads)">
                <input
                  type="checkbox"
                  checked={light}
                  onChange={(e) => {
                    setLightMode(e.target.checked);
                    setLight(e.target.checked);
                  }}
                />
                Lichte AI-modus
              </label>
              <p className="muted small">
                Alles wordt alleen op dit apparaat bewaard. Met een back-up zet je het over naar een ander apparaat of deel je het met je
                partner.
              </p>
              {menuMessage && <p className="small">{menuMessage}</p>}
            </div>
          </details>
        </div>
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {t.count ? <span className="count">{t.count}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      {crashed && (
        <div className="banner" role="status">
          <span>
            De app is de vorige keer gestopt tijdens {crashed} — waarschijnlijk had het apparaat te weinig geheugen. De{" "}
            <strong>lichte AI-modus</strong> staat nu aan (kleinere modellen). Je werk is bewaard.
          </span>
          <button className="ghost" onClick={() => setCrashed(null)} aria-label="Sluiten">
            ✕
          </button>
        </div>
      )}

      {!loaded ? (
        <p className="empty">Laden…</p>
      ) : tab === "woning" ? (
        <ListingPanel
          project={project}
          update={update}
          onDecorate={(id) => {
            setPhotoId(id);
            setTab("visualiseren");
          }}
        />
      ) : tab === "producten" ? (
        <ProductsPanel project={project} update={update} />
      ) : (
        <Visualizer project={project} update={update} photoId={photoId} setPhotoId={setPhotoId} />
      )}
    </main>
  );
}
