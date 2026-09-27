"use client";

import { Camera, Check, Copy, Plus, Receipt, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { aiQuote } from "@/lib/ai";
import { euroCents, FAL_COST } from "@/lib/fal";
import { fileToDataUrl } from "@/lib/images";
import { cheapestQuote, KIND_ORDER, KINDS, RENO_STATUS, renovationOf, taskCost, taskEnd } from "@/lib/renovation";
import { newId } from "@/lib/rooms";
import { euro } from "@/lib/shopping";
import { addQuote, addTasks, chooseQuote, patchTask, removeQuote, removeTask } from "@/lib/tasks";
import type { RenoKind, Task } from "@/lib/types";
import { useApp } from "./app";
import { I, RENO_STATUS_ICON } from "./icons";
import { EuroInput, Sheet, Stepper } from "./ui";

export function TaskSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { project, update, toast, fal } = useApp();
  const task = renovationOf(project).tasks.find((t) => t.id === id)!;
  const set = (patch: Partial<Task>) => update(patchTask(task.id, patch));
  const c = taskCost(task);
  const cheapest = cheapestQuote(task);
  const [quote, setQuote] = useState({ company: "", amount: undefined as number | undefined, note: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // A new job without a name is not kept.
  const close = () => {
    if (!task.title.trim()) update(removeTask(task.id));
    onClose();
  };

  const toggleRoom = (roomId: string) =>
    set({ roomIds: task.roomIds.includes(roomId) ? task.roomIds.filter((r) => r !== roomId) : [...task.roomIds, roomId] });

  async function readQuote(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy("Offerte lezen…");
    try {
      const q = await aiQuote(await fileToDataUrl(file, 1600), (m) => m && setBusy(m));
      update(addQuote(task.id, { id: newId(), company: q.company, amount: q.amount, note: q.note, contact: q.contact, addedAt: Date.now() }));
      toast(`Offerte van ${q.company}: ${euro(q.amount, true)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Sheet
      wide
      title={task.title ? "Klus" : "Nieuwe klus"}
      onClose={close}
      footer={
        <>
          <button
            className="ghost danger"
            onClick={() => {
              const before = project;
              update(removeTask(task.id));
              onClose();
              if (task.title) toast("Klus verwijderd", () => update(() => before));
            }}
          >
            <I icon={Trash} /> Verwijderen
          </button>
          <button
            className="ghost"
            onClick={() => {
              update(addTasks([{ ...task, id: newId(), status: "idee", quotes: [], chosenQuote: undefined, start: undefined, addedAt: Date.now() }]));
              toast("Klus gedupliceerd");
            }}
          >
            <I icon={Copy} /> Dupliceren
          </button>
          <span className="grow" />
          <button className="primary" onClick={close}>
            Klaar
          </button>
        </>
      }
    >
      {task.why && <p className="card quiet small">{task.why}</p>}

      <label className="field">
        Wat gaat er gebeuren?
        <input autoFocus={!task.title} placeholder="Bijv. muren woonkamer schilderen" value={task.title} onChange={(e) => set({ title: e.target.value })} />
      </label>

      <div className="field-row">
        <label className="field">
          Soort klus
          <select value={task.kind} onChange={(e) => set({ kind: e.target.value as RenoKind })}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          Wie doet het?
          <div className="segmented fill" role="group" aria-label="Wie doet het">
            <button className={task.who === "zelf" ? "on" : ""} aria-pressed={task.who === "zelf"} onClick={() => set({ who: "zelf" })}>
              Zelf
            </button>
            <button className={task.who === "vakman" ? "on" : ""} aria-pressed={task.who === "vakman"} onClick={() => set({ who: "vakman" })}>
              Vakman
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        Waar?
        <div className="row wrap-row" style={{ gap: 6 }}>
          <button className={`chip ${task.roomIds.length === 0 ? "accent" : ""}`} aria-pressed={task.roomIds.length === 0} onClick={() => set({ roomIds: [] })}>
            Hele huis
          </button>
          {project.rooms.map((r) => (
            <button key={r.id} className={`chip ${task.roomIds.includes(r.id) ? "accent" : ""}`} aria-pressed={task.roomIds.includes(r.id)} onClick={() => toggleRoom(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        Status
        <div className="segmented fill" role="group" aria-label="Status">
          {RENO_STATUS.map((s) => (
            <button key={s.id} className={task.status === s.id ? "on" : ""} aria-pressed={task.status === s.id} onClick={() => set({ status: s.id })}>
              <I icon={RENO_STATUS_ICON[s.id]} size={16} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          {task.who === "zelf" ? "Kosten materiaal" : "Richtprijs"}
          <EuroInput value={task.estimate} onChange={(estimate) => set({ estimate })} placeholder="schatting" />
        </label>
        <label className="field">
          Werkdagen
          <Stepper value={task.days ?? KINDS[task.kind].days} onChange={(days) => set({ days })} />
        </label>
        <label className="field">
          Start
          <input type="date" value={task.start ?? ""} onChange={(e) => set({ start: e.target.value || undefined })} />
        </label>
      </div>
      <div className="row wrap-row between">
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={task.beforeMove} onChange={(e) => set({ beforeMove: e.target.checked })} />
          Moet klaar zijn vóór de verhuizing
        </label>
        <span className="small muted">
          {task.start && taskEnd(task) ? `Klaar op ${new Date(`${taskEnd(task)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long" })} · ` : ""}
          Kosten:{" "}
          <strong style={{ color: c.firm ? "var(--ink)" : "var(--estimate)" }}>{c.known ? `${c.firm ? "" : "± "}${euro(c.value)}` : "onbekend"}</strong>
        </span>
      </div>

      {task.who === "vakman" && (
        <div className="stack">
          <hr className="divider" />
          <div className="section-head">
            <div>
              <h2 style={{ fontSize: 20 }}>Offertes</h2>
              <p className="tiny muted">Vraag er minstens drie aan en kies er één: dan staat de prijs vast.</p>
            </div>
            {fal && (
              <label className={`btn ai small${busy ? " is-busy" : ""}`}>
                {busy ? <span className="spinner" /> : <I icon={Camera} />} {busy || "Offerte lezen"} {!busy && <span className="cost">{euroCents(FAL_COST.quote)}</span>}
                <input type="file" accept="image/*" hidden onChange={(e) => readQuote(e.target.files?.[0])} disabled={!!busy} />
              </label>
            )}
          </div>
          {error && (
            <p className="small error" role="alert">
              {error}
            </p>
          )}
          {task.quotes.length > 0 && (
            <div className="items">
              {[...task.quotes]
                .sort((a, b) => a.amount - b.amount)
                .map((q) => {
                  const chosen = q.id === task.chosenQuote;
                  return (
                    <div key={q.id} className="item quote">
                      <span className={`icon-badge${chosen ? " accent" : ""}`}>
                        <I icon={Receipt} size={20} />
                      </span>
                      <div className="grow stack tight">
                        <strong>{q.company}</strong>
                        {(q.note || q.contact) && <span className="tiny muted">{[q.note, q.contact].filter(Boolean).join(" · ")}</span>}
                      </div>
                      <div className="price">
                        <span className="amount">{euro(q.amount, q.amount % 1 !== 0)}</span>
                        {q.id === cheapest?.id && task.quotes.length > 1 && <span className="chip ok">laagste</span>}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button className={`small ${chosen ? "primary" : "soft"}`} aria-pressed={chosen} onClick={() => update(chooseQuote(task.id, chosen ? undefined : q.id))}>
                          {chosen ? <I icon={Check} weight="bold" /> : null} {chosen ? "Gekozen" : "Kies"}
                        </button>
                        <button className="small icon ghost" aria-label={`Offerte van ${q.company} verwijderen`} onClick={() => update(removeQuote(task.id, q.id))}>
                          <I icon={Trash} />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          <form
            className="row wrap-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!quote.company.trim() || !quote.amount) return;
              update(addQuote(task.id, { id: newId(), company: quote.company.trim(), amount: quote.amount, note: quote.note.trim() || undefined, addedAt: Date.now() }));
              setQuote({ company: "", amount: undefined, note: "" });
            }}
          >
            <input style={{ flex: "2 1 160px" }} placeholder="Bedrijf" aria-label="Bedrijf" value={quote.company} onChange={(e) => setQuote({ ...quote, company: e.target.value })} />
            <span style={{ flex: "1 1 110px" }}>
              <EuroInput value={quote.amount} onChange={(amount) => setQuote({ ...quote, amount })} placeholder="incl. btw" />
            </span>
            <input style={{ flex: "2 1 160px" }} placeholder="Wat zit erin (optioneel)" aria-label="Wat zit erin" value={quote.note} onChange={(e) => setQuote({ ...quote, note: e.target.value })} />
            <button className="primary" disabled={!quote.company.trim() || !quote.amount}>
              <I icon={Plus} /> Offerte
            </button>
          </form>
        </div>
      )}

      <label className="field">
        Notitie
        <textarea rows={2} placeholder="Materiaal, kleurcode, afspraken, telefoonnummer…" value={task.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
    </Sheet>
  );
}
