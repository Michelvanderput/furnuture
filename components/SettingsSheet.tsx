"use client";

import { useRef, useState } from "react";
import { backupBlob, backupFileName, readBackup, shareOrDownload } from "@/lib/backup";
import { houseLink } from "@/lib/houses";
import { ArrowsLeftRight, CloudCheck, DeviceMobile, DownloadSimple, House, LinkSimple, UploadSimple } from "@phosphor-icons/react";
import { useApp } from "./app";
import { I } from "./icons";
import { FalSetting } from "./FalSetting";
import { NotificationSettings } from "./Notifications";
import { EuroInput, Sheet } from "./ui";

const STYLES = ["Scandinavisch", "Japandi", "Modern", "Industrieel", "Landelijk", "Bohemian", "Klassiek", "Warm minimalisme"];

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { project, update, toast, house, sync, syncError, leave } = useApp();
  const online = !!house.id;
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  return (
    <Sheet title="Instellingen" onClose={onClose} footer={<button className="primary" onClick={onClose}>Klaar</button>}>
      <div className="house-pick static">
        <span className="icon-badge accent">
          <I icon={online ? CloudCheck : DeviceMobile} size={20} />
        </span>
        <span className="grow">
          <strong>{house.name}</strong>
          <span className="tiny muted">
            {online
              ? sync === "offline"
                ? "Offline: je wijzigingen worden verstuurd zodra er weer verbinding is."
                : sync === "error"
                  ? `Opslaan mislukt${syncError ? `: ${syncError}` : ""}.`
                  : "Online bewaard. Vul deze naam in op een ander apparaat om verder te gaan."
              : "Bewaard op dit apparaat."}
          </span>
        </span>
      </div>
      <div className="row wrap-row">
        {online && (
          <button
            onClick={async () => {
              const link = houseLink(house);
              try {
                if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: house.name, url: link });
                else {
                  await navigator.clipboard.writeText(link);
                  toast("Link gekopieerd");
                }
              } catch {
                // cancelled
              }
            }}
          >
            <I icon={LinkSimple} /> Link delen
          </button>
        )}
        <button
          onClick={() => {
            onClose();
            leave();
          }}
        >
          <I icon={ArrowsLeftRight} /> Andere woning
        </button>
      </div>

      <hr className="divider" />
      <NotificationSettings />

      <hr className="divider" />
      <label className="field">
        Totaalbudget voor de inrichting
        <EuroInput value={project.budget} onChange={(budget) => update((p) => ({ ...p, budget }))} placeholder="bijv. 15000" />
      </label>

      <div className="stack tight">
        <label className="field">
          Onze stijl <span className="tiny">(de AI houdt er rekening mee)</span>
          <input placeholder="Bijv. Scandinavisch, licht hout, groen als accent" value={project.style ?? ""} onChange={(e) => update((p) => ({ ...p, style: e.target.value || undefined }))} />
        </label>
        <div className="row wrap-row" style={{ gap: 6 }}>
          {STYLES.map((s) => (
            <button key={s} className={`chip ${project.style === s ? "accent" : ""}`} onClick={() => update((p) => ({ ...p, style: s }))}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <hr className="divider" />
      <FalSetting />
      <hr className="divider" />

      <div className="stack tight">
        <strong>Bewaren & delen</strong>
        <p className="tiny muted">
          {online
            ? "Een back-up is een bestand met alles van deze woning: handig om zelf te bewaren."
            : "Alles wordt op dit apparaat bewaard. Met een back-up zet je het over naar een ander apparaat of deel je het met je partner."}
        </p>
        <div className="row wrap-row">
          <button onClick={() => shareOrDownload(backupBlob(project), backupFileName(project))}>
            <I icon={DownloadSimple} /> Back-up opslaan
          </button>
          <button onClick={() => file.current?.click()}>
            <I icon={UploadSimple} /> Back-up terugzetten
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const p = await readBackup(f);
                if (!confirm("Back-up terugzetten? Wat je nu hebt, wordt vervangen.")) return;
                update(() => p);
                toast("Back-up teruggezet");
                onClose();
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Terugzetten mislukt.");
              }
            }}
          />
        </div>
        {message && <p className="error small">{message}</p>}
      </div>

      <hr className="divider" />
      <div className="stack tight">
        <strong>Opnieuw beginnen</strong>
        <div className="row wrap-row">
          <button
            onClick={() => {
              if (!confirm("Een nieuwe Funda-link laden? Je producten blijven bewaard (zonder kamer); kamers en foto's worden gewist.")) return;
              update((p) => ({ ...p, listing: null, rooms: [], items: p.items.map((i) => ({ ...i, roomId: null })) }));
              onClose();
            }}
          >
            <I icon={House} /> Nieuwe Funda-link
          </button>
          <button
            className="danger"
            onClick={() => {
              if (!confirm("Alles wissen: woning, kamers en de hele lijst? Maak eventueel eerst een back-up.")) return;
              update(() => ({ listing: null, rooms: [], items: [] }));
              onClose();
            }}
          >
            Alles wissen
          </button>
        </div>
      </div>
    </Sheet>
  );
}
