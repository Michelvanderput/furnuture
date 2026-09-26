"use client";

import { useState } from "react";
import { ListingPanel } from "@/components/ListingPanel";
import { ProductsPanel } from "@/components/ProductsPanel";
import { Visualizer } from "@/components/Visualizer";
import { useProject } from "@/lib/useProject";

type Tab = "woning" | "producten" | "visualiseren";

export default function Home() {
  const { project, update, loaded } = useProject();
  const [tab, setTab] = useState<Tab>("woning");
  const [photoId, setPhotoId] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "woning", label: "🏠 Woning", count: project.listing?.photos.length },
    { id: "producten", label: "🛋️ Producten", count: project.products.length },
    { id: "visualiseren", label: "🪄 Visualiseren" },
  ];

  return (
    <main>
      <header className="app-head">
        <h1>
          furn<span>u</span>ture
        </h1>
        <p className="muted">Richt je nieuwe huis in terwijl je op de sleutel wacht.</p>
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {t.count ? <span className="count">{t.count}</span> : null}
            </button>
          ))}
        </nav>
      </header>

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
