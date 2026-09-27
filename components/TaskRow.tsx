"use client";

import { CalendarBlank, Receipt, Warning } from "@phosphor-icons/react";
import { KINDS, RENO_STATUS, taskCost, taskEnd } from "@/lib/renovation";
import { euro } from "@/lib/shopping";
import { patchTask } from "@/lib/tasks";
import type { RenoStatus, Task } from "@/lib/types";
import { useApp } from "./app";
import { I, RENO_STATUS_ICON, RenoIcon } from "./icons";

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

export function RenoStatusPill({ status, onClick }: { status: RenoStatus; onClick?: () => void }) {
  const s = RENO_STATUS.find((x) => x.id === status)!;
  const content = (
    <>
      <I icon={RENO_STATUS_ICON[status]} size={14} weight="bold" />
      {s.label}
    </>
  );
  return onClick ? (
    <button className={`chip status reno-${status}`} onClick={onClick} aria-label={`Status: ${s.label}. Tik voor de volgende stap`}>
      {content}
    </button>
  ) : (
    <span className={`chip status reno-${status}`}>{content}</span>
  );
}

/** One renovation job in a list. */
export function TaskRow({ task, showRooms = true, late }: { task: Task; showRooms?: boolean; late?: boolean }) {
  const { project, update, openTask, toast } = useApp();
  const c = taskCost(task);
  const rooms = task.roomIds.map((id) => project.rooms.find((r) => r.id === id)?.name).filter(Boolean);
  const chosen = task.quotes.find((q) => q.id === task.chosenQuote);
  const end = taskEnd(task);
  const next = () => {
    const i = RENO_STATUS.findIndex((s) => s.id === task.status);
    const status = RENO_STATUS[(i + 1) % RENO_STATUS.length].id;
    update(patchTask(task.id, { status }));
    if (status === "klaar") toast(`${task.title} is klaar`);
  };
  return (
    <div className={`item task${task.status === "klaar" ? " is-bought" : ""}`}>
      <button type="button" className="thumb task-icon" onClick={() => openTask(task.id)} aria-label={`${task.title} openen`}>
        <RenoIcon kind={task.kind} size={28} />
      </button>
      <button type="button" className="info" onClick={() => openTask(task.id)}>
        <span className="title">{task.title || "Nieuwe klus"}</span>
        <span className="meta">
          {showRooms && <span>{rooms.length ? rooms.join(", ") : "Hele huis"}</span>}
          <span className="chip">{task.who === "zelf" ? "Zelf" : "Vakman"}</span>
          {chosen ? (
            <span className="chip ok">
              <I icon={Receipt} size={13} /> {chosen.company}
            </span>
          ) : task.quotes.length > 0 ? (
            <span className="chip accent">
              <I icon={Receipt} size={13} /> {task.quotes.length} offerte{task.quotes.length > 1 ? "s" : ""}
            </span>
          ) : null}
          {task.start && (
            <span className="chip">
              <I icon={CalendarBlank} size={13} /> {shortDate(task.start)}
              {end && end !== task.start ? ` – ${shortDate(end)}` : ""}
            </span>
          )}
          {late && (
            <span className="chip danger">
              <I icon={Warning} size={13} weight="bold" /> na verhuizing
            </span>
          )}
        </span>
      </button>
      <div className="price">
        {c.known ? (
          <span className={`amount${c.firm ? "" : " est"}`}>
            {c.firm ? "" : "± "}
            {euro(c.value)}
          </span>
        ) : (
          <span className="amount none">prijs?</span>
        )}
        <RenoStatusPill status={task.status} onClick={next} />
      </div>
    </div>
  );
}

export const kindLabel = (t: Task) => KINDS[t.kind].label;
