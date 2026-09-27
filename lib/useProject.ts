"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { migrate } from "./migrate";
import { loadProject, markSaved, requestPersistence, saveProject } from "./storage";
import type { Project } from "./types";

export { newId } from "./rooms";

export const EMPTY: Project = { listing: null, rooms: [], items: [] };

/** Quiet time before saving: a burst of changes (typing) becomes one write. */
const SAVE_DELAY = 600;

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
        // Data in this format needs no write; converted data is written in full on the first save.
        if (stored.current) markSaved(stored.project);
        setProject(stored.project);
        if (!stored.current) dirty.current = true;
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

  useEffect(() => {
    if (!loaded) return;
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY);
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
  const replace = useCallback((p: unknown) => setProject(migrate(p)), []);

  return { project, update, replace, loaded };
}
