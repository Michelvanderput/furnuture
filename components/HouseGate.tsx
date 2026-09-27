"use client";

import { ArrowRight, ClockCounterClockwise, CloudCheck, DeviceMobile, HouseLine, Info, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { extractFundaPhotos } from "@/lib/extract";
import {
  clearImportHash,
  createRemote,
  findRemote,
  houseKey,
  importFromHash,
  legacyMoved,
  recentHouses,
  RemoteError,
  remoteConfigured,
  withHouse,
  type HouseRef,
} from "@/lib/houses";
import { loadProject, saveProject } from "@/lib/storage";
import type { Project } from "@/lib/types";
import { EMPTY } from "@/lib/useProject";
import { I } from "./icons";
import { Features, Welcome, WelcomeLayout } from "./Welcome";

const hasContent = (p: Project) => !!(p.listing || p.rooms.length || p.items.length || p.renovation?.tasks.length);

/**
 * The first screen: which house? A known name opens that house (on any device, when
 * there is a database); a new name asks for its Funda link.
 */
export function HouseGate({ initialName, onOpen }: { initialName?: string; onOpen: (ref: HouseRef) => void }) {
  const [name, setName] = useState(initialName ?? "");
  const [step, setStep] = useState<"name" | "new">("name");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [db, setDb] = useState<boolean | null>(null);
  const [legacy, setLegacy] = useState<Project | null>(null);
  const [recent] = useState(recentHouses);
  const [imported] = useState(() => importFromHash(extractFundaPhotos));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    remoteConfigured().then(setDb);
    // What earlier versions of the app kept on this device, before houses had names.
    if (!legacyMoved.get())
      loadProject("").then((stored) => {
        if (!stored || !hasContent(stored.project)) return;
        setLegacy(stored.project);
        setName((n) => n || stored.project.listing?.title || "");
      });
    if (initialName) lookup(initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Opens the house with this name, or asks how to start a new one. */
  async function lookup(raw: string) {
    const n = raw.trim().replace(/\s+/g, " ");
    const key = houseKey(n);
    if (!key) return setError("Vul een naam in, bijvoorbeeld het adres.");
    setBusy(true);
    setError("");
    try {
      const known = recentHouses().find((h) => h.key === key);
      if (await remoteConfigured()) {
        let found;
        try {
          found = await findRemote(n);
        } catch (e) {
          // Offline: a house opened here before still works from this device's copy.
          if (known?.id) return onOpen(known);
          throw e;
        }
        if (found) return onOpen({ key, name: found.name, id: found.id, title: found.title ?? undefined });
        // Kept only on this device so far (from before there was a database): put it online.
        if (known) {
          const stored = await loadProject(key);
          if (stored && hasContent(stored.project)) return onOpen(await create(n, stored.project));
        }
      } else if (known) return onOpen(known);
      setName(n);
      setStep("new");
    } catch (e) {
      setError(e instanceof RemoteError && e.status === 0 ? "Geen verbinding: probeer het zo nog eens." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** A new house: in the database (when there is one) and on this device. */
  async function create(n: string, project: Project): Promise<HouseRef> {
    const key = houseKey(n);
    let ref: HouseRef = { key, name: n, title: project.listing?.title };
    if (await remoteConfigured()) {
      try {
        ref = { ...ref, id: (await createRemote(n, project)).id };
      } catch (e) {
        // Someone else just took this name: open theirs.
        if (e instanceof RemoteError && e.status === 409) {
          const found = await findRemote(n);
          if (found) return { key, name: found.name, id: found.id, title: found.title ?? undefined };
        }
        throw e;
      }
    }
    await saveProject(project, key);
    return ref;
  }

  async function start(project: Project, fromLegacy = false) {
    setError("");
    try {
      const ref = await create(name, project);
      if (fromLegacy) legacyMoved.set();
      if (imported) clearImportHash();
      onOpen(ref);
    } catch (e) {
      const message = e instanceof RemoteError && e.status === 0 ? "Geen verbinding: probeer het zo nog eens." : e instanceof Error ? e.message : String(e);
      setError(message);
    }
  }

  if (step === "new") {
    return (
      <Welcome
        name={name}
        onImport={(url, data) => start(withHouse(EMPTY, url, data))}
        onBlank={(photos) => start(withHouse(EMPTY, "", { title: name, photos }))}
        onBack={() => {
          setStep("name");
          setTimeout(() => input.current?.focus());
        }}
      >
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        {imported && (
          <StartOption
            icon={HouseLine}
            title={imported.data.title || "Woning van Funda"}
            text={`Via de knop in je bladwijzers: ${imported.data.photos.length} foto's`}
            action="Deze gebruiken"
            onClick={() => start(withHouse(EMPTY, imported.url, imported.data))}
          />
        )}
        {legacy && (
          <StartOption
            icon={UploadSimple}
            title={legacy.listing?.title || "Wat al op dit apparaat staat"}
            text={`Al op dit apparaat: ${legacy.rooms.length} kamers, ${legacy.items.length} producten${legacy.renovation?.tasks.length ? `, ${legacy.renovation.tasks.length} klussen` : ""}`}
            action="Overnemen"
            onClick={() => start(legacy, true)}
          />
        )}
      </Welcome>
    );
  }

  return (
    <WelcomeLayout>
      <div className="stack" style={{ gap: 16 }}>
        <h1>
          Van sleutel tot <em>thuis</em>.
        </h1>
        <p className="intro">Hoe heet je woning? Met dezelfde naam open je hem op elk apparaat, ook samen met je partner.</p>
      </div>
      <form
        className="url-bar"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(name);
        }}
      >
        <input
          ref={input}
          autoFocus
          required
          autoComplete="off"
          enterKeyHint="go"
          maxLength={60}
          placeholder="Bijv. Dorpsstraat 12 Utrecht"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Naam van je woning"
        />
        <button className="accent" disabled={busy || !name.trim()}>
          {busy ? <span className="spinner" /> : <>Verder <I icon={ArrowRight} weight="bold" /></>}
        </button>
      </form>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <p className="tiny muted row" style={{ gap: 6, alignItems: "flex-start" }}>
        <I icon={db === false ? DeviceMobile : db ? CloudCheck : Info} size={16} />
        {db === false
          ? "Er is (nog) geen online opslag gekoppeld: je woning wordt op dit apparaat bewaard."
          : "Iedereen die de naam kent, kan de woning openen. Kies dus iets unieks, zoals je adres met huisnummer en plaats."}
      </p>

      {recent.length > 0 && (
        <div className="stack tight">
          <span className="eyebrow">
            <I icon={ClockCounterClockwise} size={14} /> Eerder geopend
          </span>
          <div className="house-list">
            {recent.map((h) => (
              <button key={h.key} className="house-pick" disabled={busy} onClick={() => lookup(h.name)}>
                <span className="icon-badge">
                  <I icon={HouseLine} size={20} />
                </span>
                <span className="grow">
                  <strong>{h.name}</strong>
                  {h.title && h.title !== h.name && <span className="tiny muted">{h.title}</span>}
                </span>
                <I icon={ArrowRight} />
              </button>
            ))}
          </div>
        </div>
      )}

      {legacy && (
        <div className="card quiet small">
          <strong>Je woning van eerder staat nog op dit apparaat</strong>
          {legacy.listing?.title ? ` (${legacy.listing.title})` : ""}. Geef hem hierboven een naam: bij een nieuwe naam kun je hem overnemen.
        </div>
      )}
      <Features />
    </WelcomeLayout>
  );
}

function StartOption({ icon, title, text, action, onClick }: { icon: typeof HouseLine; title: string; text: string; action: string; onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="house-pick static">
      <span className="icon-badge accent">
        <I icon={icon} size={20} />
      </span>
      <span className="grow">
        <strong>{title}</strong>
        <span className="tiny muted">{text}</span>
      </span>
      <button
        className="primary small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onClick();
          setBusy(false);
        }}
      >
        {busy ? <span className="spinner" /> : action}
      </button>
    </div>
  );
}
