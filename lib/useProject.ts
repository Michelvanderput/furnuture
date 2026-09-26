"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { migrateProject } from "./migrate";
import { loadProject, markSaved, requestPersistence, saveProject } from "./storage";
import type { Project } from "./types";

const EMPTY: Project = { listing: null, products: [], scenes: {} };

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Quiet time before saving: a burst of changes (typing, sliders) becomes one write. */
const SAVE_DELAY = 800;

type Idle = (cb: () => void, opts?: { timeout: number }) => number;
/** Runs when the browser has nothing else to do (Safari has no requestIdleCallback). */
const whenIdle = (cb: () => void) => {
  const ric = (globalThis as unknown as { requestIdleCallback?: Idle }).requestIdleCallback;
  if (ric) ric(cb, { timeout: 1500 });
  else setTimeout(cb, 0);
};

export function useProject() {
  const [project, setProject] = useState<Project>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(project);
  latest.current = project;
  const dirty = useRef(false);

  useEffect(() => {
    loadProject().then((stored) => {
      if (stored) {
        const p = migrateProject({ ...EMPTY, ...stored.project });
        // Parts that come straight from storage need no write; old-format data is rewritten in parts.
        if (!stored.legacy) markSaved(p);
        setProject(p);
      }
      setLoaded(true);
      requestPersistence();
    });
  }, []);

  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saveProject(latest.current);
  }, []);

  // Save once changes settle, when the browser is idle. Only changed parts are written (storage.ts).
  useEffect(() => {
    if (!loaded) return;
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => whenIdle(flush), SAVE_DELAY);
  }, [project, loaded, flush]);

  // …and right away when the page is hidden: iPad Safari may discard background tabs.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  const update = useCallback((fn: (p: Project) => Project) => setProject(fn), []);
  const replace = useCallback((p: Project) => setProject(migrateProject({ ...EMPTY, ...p })), []);

  return { project, update, replace, loaded };
}
