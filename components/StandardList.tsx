"use client";

import { ArrowSquareOut, CaretDown, Check, ListChecks, MagnifyingGlass, Plus, Star } from "@phosphor-icons/react";
import { useState } from "react";
import { areaFor, CATALOG, entries, entryCost, groupsFor, hasCatalog, houseEstimate, itemFrom, onList, profileChoices, profileFor, tierPref, TIERS, type Entry, type Profile, type Tier } from "@/lib/catalog";
import { addItems } from "@/lib/items";
import { newId } from "@/lib/rooms";
import { euro } from "@/lib/shopping";
import { searchTerm, shopsFor } from "@/lib/shops";
import type { Item, Project, Room } from "@/lib/types";
import { useApp } from "./app";
import { CategoryIcon, I } from "./icons";

/** "33 m²", "4 potten", "1 rol". */
const unitLabel = (x: Entry) => {
  const u = x.measure!.unit;
  const n = x.qty ?? 1;
  return n === 1 ? u : u === "pot" ? "potten" : u === "rol" ? "rollen" : u === "zak" ? "zakken" : u;
};

/** Budget / Midden / Luxe: the rough prices of the list follow. */
export function TierPicker({ tier, onChange }: { tier: Tier; onChange: (t: Tier) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Prijsniveau">
      {TIERS.map((t) => (
        <button key={t.id} className={tier === t.id ? "on" : ""} aria-pressed={tier === t.id} title={t.hint} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** What this kind of room usually needs, to put on the list with a tap. */
export function StandardList({ room }: { room: Room }) {
  const { project, update, toast } = useApp();
  const [tier, setTierState] = useState<Tier>(tierPref.get);
  const [profile, setProfile] = useState<Profile>(() => profileFor(room, project.rooms));
  const roomItems = project.items.filter((i) => i.roomId === room.id);
  const [open, setOpen] = useState(roomItems.length === 0);
  if (!hasCatalog(room)) return null;

  const setTier = (t: Tier) => {
    tierPref.set(t);
    setTierState(t);
  };
  const all = entries(profile, room);
  const missing = all.filter((x) => !onList(project.items, room.id, x));
  const missingMust = missing.filter((x) => x.must);
  const choices = profileChoices(room.type);
  const add = (list: Entry[]) => {
    if (!list.length) return;
    const before = project;
    update(addItems(list.map((x) => itemFrom(x, room.id, tier, newId()))));
    toast(list.length === 1 ? `${list[0].title} op de lijst` : `${list.length} dingen op de lijst`, () => update(() => before));
  };
  const sum = (list: Entry[]) => list.reduce((s, x) => s + entryCost(x, tier), 0);

  return (
    <div className="card stack standard-list">
      <button className="card-head as-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="title">
          <span className="icon-badge accent">
            <I icon={ListChecks} size={20} />
          </span>
          <span className="stack" style={{ gap: 0, textAlign: "left" }}>
            <strong>Standaardlijst {CATALOG[profile].label.toLowerCase()}</strong>
            <span className="tiny muted">
              {all.length - missing.length} van {all.length} op je lijst
              {missingMust.length ? ` · nog ${missingMust.length} must-haves (± ${euro(sum(missingMust))})` : " · alle must-haves staan erop"}
            </span>
          </span>
        </span>
        <I icon={CaretDown} size={18} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform var(--t-fast)" }} />
      </button>

      {open && (
        <>
          <div className="row wrap-row between" style={{ gap: 10 }}>
            <div className="row wrap-row" style={{ gap: 10 }}>
              <TierPicker tier={tier} onChange={setTier} />
              {choices.length > 1 && (
                <select aria-label="Soort kamer" value={profile} onChange={(e) => setProfile(e.target.value as Profile)} style={{ width: "auto" }}>
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {CATALOG[c].label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="row wrap-row" style={{ gap: 8 }}>
              {missingMust.length > 0 && (
                <button className="primary small" onClick={() => add(missingMust)}>
                  <I icon={Star} weight="fill" /> Must-haves ({missingMust.length})
                </button>
              )}
              {missing.length > missingMust.length && (
                <button className="small" onClick={() => add(missing)}>
                  <I icon={Plus} /> Alles ({missing.length})
                </button>
              )}
            </div>
          </div>

          {groupsFor(profile, room).map((g) => (
            <div key={g.name} className="stack tight">
              <span className="eyebrow">{g.name}</span>
              {!room.area && g.items.some((x) => x.measure) && (
                <span className="tiny muted">
                  Hoeveelheden geschat voor een kamer van ± {areaFor(room, profile)} m². Vul de m² in bij <strong>Bewerken</strong> (bovenaan) voor een precieze berekening.
                </span>
              )}
              <div className="std-grid">
                {g.items.map((x) => {
                  const has = onList(project.items, room.id, x);
                  return (
                    <button key={x.title} className={`std-item${has ? " has" : ""}`} disabled={has} onClick={() => add([x])} title={x.hint} aria-label={has ? `${x.title}: staat op je lijst` : `${x.title} op de lijst zetten`}>
                      <span className="std-icon">{has ? <I icon={Check} size={18} weight="bold" /> : <CategoryIcon category={x.category} size={18} />}</span>
                      <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                        <span className="std-title">
                          {x.measure ? `${x.qty} ${unitLabel(x)} · ` : x.qty && x.qty > 1 ? `${x.qty}× ` : ""}
                          {x.title}
                          {x.must && <I icon={Star} size={12} weight="fill" className="std-star" aria-label="must-have" />}
                        </span>
                        {x.hint && <span className="tiny muted std-hint">{x.hint}</span>}
                      </span>
                      <span className="std-price">{has ? "op lijst" : `± ${euro(entryCost(x, tier))}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="tiny muted">
            <I icon={Star} size={12} weight="fill" /> = must-have op de verhuisdag. Prijzen zijn richtprijzen ({TIERS[tier].hint}); koppel later een echte link.
          </p>
        </>
      )}
    </div>
  );
}

/** For the whole house at once: the must-haves of every room, and what that costs. */
export function HouseStarter({ project }: { project: Project }) {
  const { update, toast } = useApp();
  const [tier, setTierState] = useState<Tier>(tierPref.get);
  const rooms = project.rooms.filter(hasCatalog);
  if (!rooms.length) return null;
  const pending = rooms.flatMap((r) => entries(profileFor(r, project.rooms), r).filter((x) => x.must && !onList(project.items, r.id, x)).map((x) => ({ r, x })));
  const est = houseEstimate(project.rooms, tier);
  const onListCount = project.items.filter((i) => i.suggestion).length;
  // Once the list is well under way, this card has done its job.
  if (!pending.length || onListCount > 25) return null;
  const setTier = (t: Tier) => {
    tierPref.set(t);
    setTierState(t);
  };
  return (
    <div className="card stack">
      <div className="card-head">
        <div className="title">
          <span className="icon-badge accent">
            <I icon={ListChecks} size={20} />
          </span>
          <div>
            <h2 style={{ fontSize: 21 }}>Snel starten</h2>
            <p className="tiny muted">Wat een huis als dit nodig heeft, per kamer. Vink daarna per kamer aan wat je nog meer wilt.</p>
          </div>
        </div>
        <TierPicker tier={tier} onChange={setTier} />
      </div>
      <div className="grid stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className="stat">
          <span className="label">Must-haves</span>
          <span className="value">± {euro(est.must)}</span>
          <span className="sub">voor de verhuisdag</span>
        </div>
        <div className="stat">
          <span className="label">Compleet ingericht</span>
          <span className="value">± {euro(est.all)}</span>
          <span className="sub">alles van de standaardlijsten</span>
        </div>
      </div>
      <div className="row wrap-row">
        <button
          className="primary"
          onClick={() => {
            const before = project;
            update(addItems(pending.map(({ r, x }) => itemFrom(x, r.id, tier, newId()))));
            toast(`${pending.length} must-haves in ${new Set(pending.map((p) => p.r.id)).size} kamers op de lijst`, () => update(() => before));
          }}
        >
          <I icon={Star} weight="fill" /> Must-haves van alle kamers ({pending.length})
        </button>
        {project.budget === undefined && (
          <button className="soft" onClick={() => update((p) => ({ ...p, budget: Math.round(est.all / 500) * 500 }))}>
            Gebruik ± {euro(Math.round(est.all / 500) * 500)} als budget
          </button>
        )}
      </div>
    </div>
  );
}

/** Where to look: the product's name searched at shops that sell this kind of thing. */
export function ShopSearch({ item, label = "Zoek bij" }: { item: Item; label?: string }) {
  const term = searchTerm(item.suggestion ?? item.title) || item.title;
  return (
    <div className="stack tight">
      <span className="small strong row" style={{ gap: 6 }}>
        <I icon={MagnifyingGlass} size={16} /> {label}
      </span>
      <div className="row wrap-row" style={{ gap: 6 }}>
        {shopsFor(item.category).map((s) => (
          <a key={s.name} className="chip shop-link" href={s.search(term)} target="_blank" rel="noreferrer">
            {s.name} <I icon={ArrowSquareOut} size={12} />
          </a>
        ))}
      </div>
    </div>
  );
}
