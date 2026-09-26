"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { migrateProject } from "./migrate";
import { loadProject, requestPersistence, saveProject } from "./storage";
import type { Project } from "./types";

const EMPTY: Project = { listing: null, products: [], scenes: {} };

export const newId = () => Math.random().toString(36).slice(2, 10);

export function useProject() {
  const [project, setProject] = useState<Project>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(project);
  latest.current = project;
  const dirty = useRef(false);

  useEffect(() => {
    loadProject().then((p) => {
      if (p) setProject(migrateProject({ ...EMPTY, ...p }));
      setLoaded(true);
      requestPersistence();
    });
  }, []);

  // Save shortly after changes settle…
  useEffect(() => {
    if (!loaded) return;
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      dirty.current = false;
      saveProject(latest.current);
    }, 500);
  }, [project, loaded]);

  // …and right away when the page is hidden: iPad Safari may discard background tabs.
  useEffect(() => {
    const flush = () => {
      if (!dirty.current) return;
      clearTimeout(saveTimer.current);
      dirty.current = false;
      saveProject(latest.current);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const update = useCallback((fn: (p: Project) => Project) => setProject(fn), []);
  const replace = useCallback((p: Project) => setProject(migrateProject({ ...EMPTY, ...p })), []);

  return { project, update, replace, loaded };
}
