"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { syncAnchors } from "./layers";
import type { Layer, Project } from "./types";

type Update = (fn: (p: Project) => Project) => void;
type History = { past: Layer[][]; future: Layer[][]; lastPush: number };

const MAX_HISTORY = 60;
/** Changes closer together than this (a slider being dragged) become one undo step. */
const COALESCE_MS = 450;
const histories = new Map<string, History>();
const historyOf = (photoId: string) => {
  if (!histories.has(photoId)) histories.set(photoId, { past: [], future: [], lastPush: 0 });
  return histories.get(photoId)!;
};

/**
 * Layers of one photo with undo/redo and a cheap "draft" mode for dragging:
 * while a drag is active, changes only live in this component (no project
 * update, no saving, no re-render of the rest of the app); the result is
 * committed as one undo step when the drag ends.
 */
export function useSceneEditor(photoId: string | undefined, project: Project, update: Update) {
  const committed = (photoId && project.scenes[photoId]?.layers) || [];
  const [draft, setDraftState] = useState<Layer[] | null>(null);
  const draftRef = useRef<Layer[] | null>(null);
  const setDraft = (d: Layer[] | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const dragging = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    draftRef.current = null;
    setDraftState(null);
    dragging.current = false;
  }, [photoId]);

  const commit = useCallback(
    (fn: (layers: Layer[]) => Layer[]) => {
      if (!photoId) return;
      update((p) => {
        const current = p.scenes[photoId]?.layers ?? [];
        const next = syncAnchors(fn(current));
        const h = historyOf(photoId);
        const now = Date.now();
        // Updaters can run twice (React strict mode); only record a real change once.
        if (h.past.at(-1) !== current && now - h.lastPush > COALESCE_MS) {
          h.past.push(current);
          if (h.past.length > MAX_HISTORY) h.past.shift();
        }
        h.lastPush = now;
        h.future = [];
        return { ...p, scenes: { ...p.scenes, [photoId]: { photoId, layers: next } } };
      });
    },
    [photoId, update],
  );

  /** Change layers: into the draft while dragging, otherwise as an undoable step. */
  const setLayers = useCallback(
    (fn: (layers: Layer[]) => Layer[]) => {
      if (dragging.current) setDraft(syncAnchors(fn(draftRef.current ?? committedRef.current)));
      else commit(fn);
    },
    [commit],
  );

  const committedRef = useRef(committed);
  committedRef.current = committed;

  const beginDrag = useCallback(() => {
    dragging.current = true;
    setDraft(committedRef.current);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const final = draftRef.current;
    setDraft(null);
    if (final && final !== committedRef.current) {
      historyOf(photoId ?? "").lastPush = 0; // a drag is always its own undo step
      commit(() => final);
    }
  }, [commit, photoId]);

  const replace = (from: "past" | "future", to: "past" | "future") => {
    if (!photoId) return;
    const h = historyOf(photoId);
    const target = h[from].pop();
    if (!target) return;
    h[to].push(committedRef.current);
    h.lastPush = 0;
    update((p) => ({ ...p, scenes: { ...p.scenes, [photoId]: { photoId, layers: target } } }));
    force((n) => n + 1);
  };

  const h = photoId ? historyOf(photoId) : null;
  return {
    layers: draft ?? committed,
    setLayers,
    beginDrag,
    endDrag,
    undo: () => replace("past", "future"),
    redo: () => replace("future", "past"),
    canUndo: !!h?.past.length,
    canRedo: !!h?.future.length,
  };
}
