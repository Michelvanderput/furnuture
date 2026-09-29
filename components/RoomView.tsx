"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CaretDown, CaretRight, Check, Hammer, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { CATEGORIES } from "@/lib/categories";
import { patchRoom, removeRoom } from "@/lib/items";
import { FURNISHABLE, roomPhotos } from "@/lib/rooms";
import { go } from "@/lib/route";
import { alternativesOf, euro, isBought, itemsIn, lineCost, mainItems, totals } from "@/lib/shopping";
import type { Category, Item, Room, RoomType } from "@/lib/types";
import { roomLabel } from "@/lib/categories";
import { useApp } from "./app";
import { newTask, RenoSuggestions } from "./RenovationView";
import { TaskRow } from "./TaskRow";
import { renovationOf, renoTotals } from "@/lib/renovation";
import { addTasks } from "@/lib/tasks";
import { CategoryIcon, I, RoomIcon } from "./icons";
import { Img } from "./Img";
import { ItemRow } from "./ItemRow";
import { StandardList } from "./StandardList";
import { BudgetBar, EuroInput, Lightbox, Sheet } from "./ui";

type Filter = "alles" | "kopen" | "gekocht" | "must";

export function RoomView({ roomId }: { roomId: string }) {
  const { project, openAdd } = useApp();
  const room = project.rooms.find((r) => r.id === roomId)!;
  const photos = roomPhotos(project.listing, room.id);
  const all = itemsIn(project.items, room.id);
  const t = totals(all);
  const [filter, setFilter] = useState<Filter>("alles");
  const [sort, setSort] = useState<"soort" | "prijs" | "nieuw">("soort");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  const list = useMemo(() => {
    const main = mainItems(all).filter((i) =>
      filter === "kopen" ? !isBought(i) : filter === "gekocht" ? isBought(i) : filter === "must" ? i.must : true,
    );
    if (sort === "prijs") return [...main].sort((a, b) => lineCost(b).value - lineCost(a).value);
    if (sort === "nieuw") return [...main].sort((a, b) => b.addedAt - a.addedAt);
    return main;
  }, [all, filter, sort]);

  const groups = useMemo(() => {
    if (sort !== "soort") return [{ key: "all", label: "", items: list }];
    return CATEGORIES.map((c) => ({ key: c.id, label: c.label, items: list.filter((i) => i.category === c.id) })).filter((g) => g.items.length);
  }, [list, sort]);

  const over = !!room.budget && t.planned > room.budget;

  return (
    <section className="page">
      <div className="stack tight">
        <a href="#/kamers" className="back">
          <I icon={ArrowLeft} size={16} /> Alle kamers
        </a>
        <div className="page-head">
          <div className="row top" style={{ gap: 14 }}>
            <span className="icon-badge accent" style={{ width: 48, height: 48 }}>
              <RoomIcon type={room.type} size={26} />
            </span>
            <div>
              <h1>{room.name}</h1>
              <p className="lead small">
                {[room.floor, room.area && `${room.area} m²`, `${t.count} ${t.count === 1 ? "item" : "items"}`].filter(Boolean).join(" · ")}
                {room.note ? ` — ${room.note}` : ""}
              </p>
            </div>
          </div>
          <button onClick={() => setEditing(true)}>
            <I icon={PencilSimple} /> Bewerken
          </button>
        </div>
      </div>

      {photos.length > 0 && (
        <div className="gallery" aria-label={`Foto's van ${room.name}`}>
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setLightbox(i)} aria-label={`Foto ${i + 1} vergroten`}>
              <Img src={p.url} width={640} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div className="card stack">
        <div className="row between wrap-row">
          <div className="stack tight">
            <span className="eyebrow">Totaal voor deze kamer</span>
            <span className="row wrap-row" style={{ alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }} className="num">
                {euro(t.planned)}
              </span>
              {room.budget ? (
                <span className={over ? "error strong" : "muted"}>
                  van {euro(room.budget)} {over ? `· ${euro(t.planned - room.budget)} te veel` : `· ${euro(room.budget - t.planned)} over`}
                </span>
              ) : (
                <button className="ghost small" onClick={() => setEditing(true)}>
                  <I icon={Plus} size={16} /> Budget instellen
                </button>
              )}
            </span>
          </div>
          <div className="row wrap-row">
            {t.spent > 0 && (
              <span className="chip ok">
                <I icon={Check} size={13} weight="bold" /> {euro(t.spent)} besteld of in huis
              </span>
            )}
            {t.estimated > 0 && <span className="chip estimate">± {euro(t.estimated)} geschat</span>}
            {t.unpriced > 0 && <span className="chip">{t.unpriced} zonder prijs</span>}
          </div>
        </div>
        <BudgetBar totals={t} budget={room.budget} />
      </div>

      <StandardList room={room} />

      <div className="stack">
        <div className="section-head">
          <div className="filters">
            {(
              [
                ["alles", "Alles"],
                ["kopen", "Nog kopen"],
                ["gekocht", "Besteld & in huis"],
                ["must", "Must-haves"],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
          <div className="row">
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: "auto" }} aria-label="Sorteren">
              <option value="soort">Per soort</option>
              <option value="prijs">Duurste eerst</option>
              <option value="nieuw">Nieuwste eerst</option>
            </select>
            <button className="primary" onClick={() => openAdd({ roomId: room.id })}>
              <I icon={Plus} /> Toevoegen
            </button>
          </div>
        </div>

        {all.length === 0 ? (
          <div className="empty">
            <span className="icon-badge accent">
              <RoomIcon type={room.type} size={28} />
            </span>
            <strong>Nog niets voor {room.name.toLowerCase()}</strong>
            <span className="small">Kies hierboven uit de standaardlijst, of plak een link uit een webshop.</span>
            <button className="accent" onClick={() => openAdd({ roomId: room.id })}>
              <I icon={Plus} /> Eerste product toevoegen
            </button>
          </div>
        ) : list.length === 0 ? (
          <p className="muted small center">Niets in deze selectie.</p>
        ) : (
          groups.map((g) => (
            <div className="stack tight" key={g.key}>
              {g.label && (
                <div className="group-head">
                  <span className="eyebrow">
                    <CategoryIcon category={g.key as Category} size={16} /> {g.label}
                  </span>
                  <span className="small muted num">{euro(totals(g.items).planned)}</span>
                </div>
              )}
              <div className="items">
                {g.items.map((i) => (
                  <ItemWithAlternatives key={i.id} item={i} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <RoomRenovation room={room} />

      {lightbox !== null && <Lightbox photos={photos.map((p) => p.url)} index={lightbox} onClose={() => setLightbox(null)} />}
      {editing && <RoomSheet room={room} onClose={() => setEditing(false)} />}
    </section>
  );
}

function ItemWithAlternatives({ item }: { item: Item }) {
  const { project } = useApp();
  const alts = alternativesOf(project.items, item.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ItemRow item={item} alternatives={alts.length} />
      {alts.length > 0 && (
        <div style={{ padding: "4px 12px" }}>
          <button className="ghost small more-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <I icon={open ? CaretDown : CaretRight} size={14} />
            {open ? "Opties verbergen" : `${alts.length} optie${alts.length > 1 ? "s" : ""} bekijken`}
          </button>
        </div>
      )}
      {open && alts.map((a) => <ItemRow key={a.id} item={a} alt />)}
    </>
  );
}

export function RoomSheet({ room, onClose }: { room: Room; onClose: () => void }) {
  const { project, update, toast } = useApp();
  const set = (patch: Partial<Room>) => update(patchRoom(room.id, patch));
  const count = mainItems(itemsIn(project.items, room.id)).length;
  return (
    <Sheet
      title="Kamer bewerken"
      onClose={onClose}
      footer={
        <>
          <button
            className="ghost danger"
            onClick={() => {
              if (count && !confirm(`${room.name} verwijderen? De ${count} items blijven bewaard onder "Nog geen kamer".`)) return;
              const before = project;
              update(removeRoom(room.id));
              onClose();
              go({ view: "kamers" });
              toast(`${room.name} verwijderd`, () => update(() => before));
            }}
          >
            <I icon={Trash} /> Verwijderen
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            Klaar
          </button>
        </>
      }
    >
      <label className="field">
        Naam
        <input value={room.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          Soort
          <select value={room.type} onChange={(e) => set({ type: e.target.value as RoomType })}>
            {FURNISHABLE.map((t) => (
              <option key={t} value={t}>
                {roomLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Verdieping
          <input placeholder="Begane grond" value={room.floor ?? ""} onChange={(e) => set({ floor: e.target.value || undefined })} />
        </label>
        <label className="field">
          Oppervlakte (m²)
          <input inputMode="numeric" value={room.area ?? ""} onChange={(e) => set({ area: Number(e.target.value) || undefined })} />
        </label>
      </div>
      <label className="field">
        Budget voor deze kamer
        <EuroInput value={room.budget} onChange={(budget) => set({ budget })} placeholder="geen" />
      </label>
      <label className="field">
        Notitie
        <input placeholder="Bijv. muur 3,40 m breed, raam op het zuiden" value={room.note ?? ""} onChange={(e) => set({ note: e.target.value || undefined })} />
      </label>
    </Sheet>
  );
}

/** Renovation jobs for this room, and what usually comes up in a room like it. */
function RoomRenovation({ room }: { room: Room }) {
  const { project, update, openTask } = useApp();
  const tasks = renovationOf(project).tasks.filter((t) => t.roomIds.includes(room.id));
  const total = renoTotals(tasks).total;
  return (
    <div className="stack">
      <div className="section-head">
        <div className="row" style={{ gap: 10 }}>
          <span className="icon-badge">
            <I icon={Hammer} size={20} />
          </span>
          <div>
            <h2 style={{ fontSize: 21 }}>Klussen in deze kamer</h2>
            <p className="tiny muted">{tasks.length ? `${tasks.length} klussen · ± ${euro(total)}` : "Schilderen, vloer, elektra: alles wat er eerst moet gebeuren."}</p>
          </div>
        </div>
        <div className="row">
          <a className="btn ghost small" href="#/verbouwing">
            Hele verbouwing
          </a>
          <button
            className="small"
            onClick={() => {
              const t = newTask([room.id]);
              update(addTasks([t]));
              openTask(t.id);
            }}
          >
            <I icon={Plus} /> Klus
          </button>
        </div>
      </div>
      {tasks.length > 0 && (
        <div className="items">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} showRooms={false} />
          ))}
        </div>
      )}
      <RenoSuggestions project={project} roomId={room.id} compact />
    </div>
  );
}
