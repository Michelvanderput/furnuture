"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadProject, saveProject } from "./storage";
import type { Project } from "./types";

const EMPTY: Project = { listing: null, products: [], scenes: {} };

export const newId = () => Math.random().toString(36).slice(2, 10);

export function useProject() {
  const [project, setProject] = useState<Project>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    loadProject().then((p) => {
      if (p) setProject({ ...EMPTY, ...p });
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveProject(project), 300);
  }, [project, loaded]);

  const update = useCallback((fn: (p: Project) => Project) => setProject(fn), []);

  return { project, update, loaded };
}
