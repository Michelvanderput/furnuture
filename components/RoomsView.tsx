"use client";

import { useState } from "react";
import { roomLabel } from "@/lib/categories";
import { moveRoom } from "@/lib/items";
import { ArrowDown, ArrowsDownUp, ArrowUp, Check, Plus, House } from "@phosphor-icons/react";
import { FURNISHABLE, newRoom, roomPhotos } from "@/lib/rooms";
import { go, href } from "@/lib/route";
import { euro, itemsIn, mainItems, totals } from "@/lib/shopping";
import type { Room, RoomType } from "@/lib/types";
import { useApp } from "./app";
import { I, RoomIcon } from "./icons";
import { Img } from "./Img";
import { ItemRow } from "./ItemRow";
import { BudgetBar } from "./ui";

export function RoomCard({ room, hideFloor }: { room: Room; hideFloor?: boolean }) {
  const { project } = useApp();
  const t = totals(itemsIn(project.items, room.id));
  const photo = roomPhotos(project.listing, room.id)[0];
  const over = !!room.budget && t.planned > room.budget;
  return (
    <a className="room-card" href={href({ view: "kamer", id: room.id })}>
      <div className="pic">
        {photo ? (
          <Img src={photo.url} width={640} alt="" loading="lazy" />
        ) : (
          <span className="placeholder">
            <RoomIcon type={room.type} size={40} />
          </span>
        )}
        {(room.area || (room.floor && !hideFloor)) && (
          <span className="badge">{[room.area ? `${room.area} m²` : "", hideFloor ? "" : room.floor].filter(Boolean).join(" · ")}</span>
        )}
      </div>
      <div className="body">
        <div className="row between">
          <h3 className="clip">{room.name}</h3>
          {t.count > 0 && (
            <span className="tiny muted nowrap">
              {t.bought}/{t.count} gekocht
            </span>
          )}
        </div>
        <div className="row between" style={{ alignItems: "baseline" }}>
          <span className="total num">{euro(t.planned)}</span>
          {room.budget ? (
            <span className={`small ${over ? "error strong" : "muted"}`}>
              {over ? `${euro(t.planned - room.budget)} te veel` : `${euro(room.budget - t.planned)} over`}
            </span>
          ) : (
            <span className="small muted">{t.count ? `${t.count} items` : "nog leeg"}</span>
          )}
        </div>
        <BudgetBar totals={t} budget={room.budget} />
      </div>
    </a>
  );
}

export function RoomsView() {
  const { project, update } = useApp();
  const [adding, setAdding] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const loose = mainItems(itemsIn(project.items, null));
  const floors = [...new Set(project.rooms.map((r) => r.floor ?? ""))];
  const grouped = floors.length > 1;

  function add(type: RoomType) {
    const room = newRoom(type, project.rooms);
    update((p) => ({ ...p, rooms: [...p.rooms, room] }));
    setAdding(false);
    go({ view: "kamer", id: room.id });
  }

  return (
    <section className="page">
      <div className="page-head">
        <div className="stack tight">
          <h1>Kamers</h1>
          <p className="lead">
            {project.rooms.length} ruimtes · {euro(totals(project.items).planned)} gepland
          </p>
        </div>
        <div className="row wrap-row">
          <a className="btn ghost" href="#/woning">
            <I icon={House} /> Woning
          </a>
          <button className="ghost" onClick={() => setOrdering((o) => !o)} aria-pressed={ordering}>
            {ordering ? <I icon={Check} /> : <I icon={ArrowsDownUp} />} {ordering ? "Klaar" : "Volgorde"}
          </button>
          <button className="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <I icon={Plus} /> Kamer
          </button>
        </div>
      </div>

      {adding && (
        <div className="card flat stack">
          <span className="small strong">Wat voor ruimte?</span>
          <div className="row wrap-row" style={{ gap: 8 }}>
            {FURNISHABLE.map((t) => (
              <button key={t} className="small" onClick={() => add(t)}>
                <RoomIcon type={t} size={16} /> {roomLabel(t)}
              </button>
            ))}
          </div>
        </div>
      )}

      {ordering ? (
        <div className="card stack tight">
          {project.rooms.map((r, i) => (
            <div key={r.id} className="row between">
              <span className="row" style={{ gap: 10 }}>
                <RoomIcon type={r.type} size={18} /> {r.name}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button className="small icon" disabled={i === 0} onClick={() => update(moveRoom(r.id, -1))} aria-label={`${r.name} omhoog`}>
                  <I icon={ArrowUp} />
                </button>
                <button className="small icon" disabled={i === project.rooms.length - 1} onClick={() => update(moveRoom(r.id, 1))} aria-label={`${r.name} omlaag`}>
                  <I icon={ArrowDown} />
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : grouped ? (
        floors.map((f) => (
          <div className="stack" key={f}>
            <span className="eyebrow">{f || "Overig"}</span>
            <div className="grid rooms">
              {project.rooms
                .filter((r) => (r.floor ?? "") === f)
                .map((r) => (
                  <RoomCard key={r.id} room={r} hideFloor />
                ))}
            </div>
          </div>
        ))
      ) : (
        <div className="grid rooms">
          {project.rooms.map((r) => (
            <RoomCard key={r.id} room={r} />
          ))}
        </div>
      )}

      {loose.length > 0 && (
        <div className="stack">
          <h2>Nog geen kamer</h2>
          <div className="items">
            {loose.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
