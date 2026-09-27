"use client";

import { useState } from "react";
import { Check, Scales, Star, TrendDown, TrendUp } from "@phosphor-icons/react";
import { categoryLabel } from "@/lib/categories";
import { patchItem } from "@/lib/items";
import { priceChange } from "@/lib/products";
import { euro, isBought, lineCost, nextStatus, statusLabel } from "@/lib/shopping";
import type { Item } from "@/lib/types";
import { useApp } from "./app";
import { CategoryIcon, I } from "./icons";
import { Img } from "./Img";
import { StatusPill } from "./ui";

export function ItemThumb({ item, size }: { item: Item; size?: number }) {
  const { openItem } = useApp();
  const [failed, setFailed] = useState(false);
  const src = failed ? undefined : (item.thumb ?? item.image);
  return (
    <button
      type="button"
      className={`thumb${src ? "" : " placeholder"}`}
      style={size ? { width: size, height: size } : undefined}
      onClick={() => openItem(item.id)}
      aria-label={`${item.title} openen`}
    >
      {src ? (
        <Img src={src} alt="" loading="lazy" onError={(e) => e.currentTarget.src.includes("/api/image") && setFailed(true)} />
      ) : (
        <CategoryIcon category={item.category} size={size ? size / 2 : 30} />
      )}
    </button>
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
          aria-label={`${item.title}: in huis`}
          aria-pressed={item.status === "binnen"}
          title="In huis"
        >
          {item.status === "binnen" && <I icon={Check} size={16} weight="bold" />}
        </button>
      )}
      <ItemThumb item={item} />
      <button type="button" className="info" onClick={() => openItem(item.id)}>
        <span className="title">{item.title}</span>
        <span className="meta">
          {item.shop && <span>{item.shop}</span>}
          {!item.url && item.estimate !== undefined && <span className="chip estimate">nog kiezen</span>}
          {room && <span className="chip">{room.name}</span>}
          {!showRoom && !item.shop && <span>{categoryLabel(item.category)}</span>}
          {item.must && (
            <span className="chip must">
              <I icon={Star} size={12} weight="fill" /> must-have
            </span>
          )}
          {alternatives > 0 && (
            <span className="chip accent">
              <I icon={Scales} size={13} /> {alternatives} optie{alternatives > 1 ? "s" : ""}
            </span>
          )}
          {change !== null && (
            <span className={`chip ${change < 0 ? "ok" : "danger"}`}>
              <I icon={change < 0 ? TrendDown : TrendUp} size={13} weight="bold" />
              {change < 0 ? `${euro(-change)} goedkoper` : `${euro(change)} duurder`}
            </span>
          )}
          {alt && <span className="chip">optie</span>}
        </span>
      </button>
      <div className="price">
        <Price item={item} />
        {item.qty > 1 && <span className="tiny muted">{item.qty}×</span>}
        {!alt && (
          <StatusPill
            status={item.status}
            onClick={() => {
              const next = nextStatus(item.status);
              update(patchItem(item.id, { status: next }));
              if (next === "binnen") toast(`${item.title.slice(0, 40)} staat in huis`);
            }}
          />
        )}
        {alt && <span className="tiny muted">{statusLabel(item.status).label}</span>}
      </div>
    </div>
  );
}
