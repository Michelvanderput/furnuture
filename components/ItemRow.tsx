"use client";

import { useState } from "react";
import { CATEGORY_EMOJI, categoryLabel } from "@/lib/categories";
import { patchItem } from "@/lib/items";
import { priceChange } from "@/lib/products";
import { euro, isBought, lineCost, nextStatus, statusLabel } from "@/lib/shopping";
import type { Item } from "@/lib/types";
import { useApp } from "./app";
import { Img } from "./Img";
import { StatusPill } from "./ui";

export function ItemThumb({ item, size }: { item: Item; size?: number }) {
  const { openItem } = useApp();
  const [failed, setFailed] = useState(false);
  const src = failed ? undefined : (item.thumb ?? item.image);
  return (
    <div
      className={`thumb${src ? "" : " placeholder"}`}
      style={size ? { width: size, height: size } : undefined}
      onClick={() => openItem(item.id)}
      role="button"
      aria-label={item.title}
    >
      {src ? <Img src={src} alt="" loading="lazy" onError={(e) => e.currentTarget.src.includes("/api/image") && setFailed(true)} /> : <span>{CATEGORY_EMOJI[item.category]}</span>}
    </div>
  );
}

export function Price({ item }: { item: Item }) {
  const c = lineCost(item);
  if (!c.known) return <span className="amount none">prijs?</span>;
  return (
    <span className={`amount${c.estimate ? " est" : ""}`} title={c.estimate ? "Schatting" : undefined}>
      {c.estimate ? "± " : ""}
      {euro(c.value, !c.estimate && c.value % 1 !== 0)}
    </span>
  );
}

/** One line of the shopping list. */
export function ItemRow({ item, alternatives = 0, showRoom, alt, check }: { item: Item; alternatives?: number; showRoom?: boolean; alt?: boolean; check?: boolean }) {
  const { project, update, openItem, toast } = useApp();
  const room = showRoom ? project.rooms.find((r) => r.id === item.roomId) : undefined;
  const change = priceChange(item);
  const bought = isBought(item);
  return (
    <div className={`item${bought ? " is-bought" : ""}${alt ? " alt" : ""}`}>
      {check && (
        <button
          className={`check${item.status === "binnen" ? " on" : ""}`}
          onClick={() => {
            const status = item.status === "binnen" ? "gekozen" : "binnen";
            update(patchItem(item.id, { status }));
          }}
          aria-label={item.status === "binnen" ? "Nog niet in huis" : "In huis"}
          title="In huis"
        >
          {item.status === "binnen" ? "✓" : ""}
        </button>
      )}
      <ItemThumb item={item} />
      <div className="info" onClick={() => openItem(item.id)}>
        <span className="title">{item.title}</span>
        <span className="meta">
          {item.shop && <span>{item.shop}</span>}
          {!item.url && item.estimate !== undefined && <span className="chip warm">nog kiezen</span>}
          {room && <span className="chip">{room.name}</span>}
          {!showRoom && !item.shop && <span>{categoryLabel(item.category)}</span>}
          {item.must && <span className="chip gold">★ must</span>}
          {alternatives > 0 && <span className="chip accent">+{alternatives} optie{alternatives > 1 ? "s" : ""}</span>}
          {change !== null && <span className={`chip ${change < 0 ? "ok" : "danger"}`}>{change < 0 ? `▼ ${euro(-change)}` : `▲ ${euro(change)}`}</span>}
          {alt && <span className="chip">alternatief</span>}
        </span>
      </div>
      <div className="price">
        <Price item={item} />
        {item.qty > 1 && <span className="tiny muted">{item.qty}×</span>}
        {!alt && (
          <StatusPill
            status={item.status}
            onClick={() => {
              const next = nextStatus(item.status);
              update(patchItem(item.id, { status: next }));
              if (next === "binnen") toast(`🎉 ${item.title.slice(0, 40)} staat in huis`);
            }}
          />
        )}
        {alt && <span className="tiny muted">{statusLabel(item.status).label}</span>}
      </div>
    </div>
  );
}
