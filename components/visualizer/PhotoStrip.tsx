"use client";

import { memo } from "react";
import { roomLabel } from "@/lib/categories";
import type { Photo } from "@/lib/types";
import { Img } from "../Img";

/** Left-hand column with the listing's room photos (small thumbnails, loaded lazily). */
export const PhotoStrip = memo(function PhotoStrip({
  photos,
  activeId,
  edited,
  onPick,
}: {
  photos: Photo[];
  activeId: string;
  edited: Set<string>;
  onPick: (id: string) => void;
}) {
  return (
    <aside className="photo-strip">
      {photos.map((p) => (
        <button key={p.id} className={p.id === activeId ? "active" : ""} onClick={() => onPick(p.id)}>
          <Img src={p.url} width={360} alt="" loading="lazy" />
          <span>
            {roomLabel(p.room)}
            {edited.has(p.id) ? " •" : ""}
          </span>
        </button>
      ))}
    </aside>
  );
});
