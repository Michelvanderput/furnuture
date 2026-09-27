"use client";

import { useState } from "react";
import { roomLabel } from "@/lib/categories";
import { moveRoom } from "@/lib/items";
import { FURNISHABLE, newRoom, ROOM_EMOJI, roomPhotos } from "@/lib/rooms";
import { go, href } from "@/lib/route";
import { euro, itemsIn, mainItems, totals } from "@/lib/shopping";
import type { Room, RoomType } from "@/lib/types";
import { useApp } from "./app";
import { Img } from "./Img";
import { ItemRow } from "./ItemRow";
import { BudgetBar } from "./ui";

export function RoomCard({ room }: { room: Room }) {
  const { project } = useApp();
  const t = totals(itemsIn(project.items, room.id));
  const photo = roomPhotos(project.listing, room.id)[0];
  const over = !!room.budget && t.planned > room.budget;
  return (
    <a className="room-card" href={href({ view: "kamer", id: room.id })}>
      <div className="pic">
        {photo ? <Img src={photo.url} width={640} alt="" loading="lazy" /> : <span className="emoji">{ROOM_EMOJI[room.type]}</span>}
        {(room.area || room.floor) && (
          <span className="badge">
            {room.area ? `${room.area} m²` : ""}
            {room.area && room.floor ? " · " : ""}
            {room.floor ?? ""}
          </span>
        )}
      </div>
      <div className="body">
        <div className="row between">
          <h3 className="clip">{room.name}</h3>
          <span className="tiny muted">{t.count ? `${t.bought}/${t.count} ✓` : ""}</span>
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
      <div className="section-head">
        <div className="stack tight">
          <h1>Kamers</h1>
          <p className="muted small">
            {project.rooms.length} ruimtes · {euro(totals(project.items).planned)} gepland
          </p>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => setOrdering((o) => !o)}>
            {ordering ? "Klaar" : "↕ Volgorde"}
          </button>
          <button className="primary" onClick={() => setAdding((a) => !a)}>
            ＋ Kamer
          </button>
        </div>
      </div>

      {adding && (
        <div className="card flat row wrap-row">
          {FURNISHABLE.map((t) => (
            <button key={t} className="small" onClick={() => add(t)}>
              {ROOM_EMOJI[t]} {roomLabel(t)}
            </button>
          ))}
        </div>
      )}

      {ordering ? (
        <div className="card stack tight">
          {project.rooms.map((r, i) => (
            <div key={r.id} className="row between">
              <span>
                {ROOM_EMOJI[r.type]} {r.name}
              </span>
              <span className="row">
                <button className="small icon" disabled={i === 0} onClick={() => update(moveRoom(r.id, -1))} aria-label="Omhoog">
                  ↑
                </button>
                <button className="small icon" disabled={i === project.rooms.length - 1} onClick={() => update(moveRoom(r.id, 1))} aria-label="Omlaag">
                  ↓
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
                  <RoomCard key={r.id} room={r} />
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
          <h2>📥 Nog geen kamer</h2>
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
