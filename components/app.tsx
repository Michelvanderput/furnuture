"use client";

import { createContext, useContext } from "react";
import type { Project } from "@/lib/types";

export interface App {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  /** Opens an item's details. */
  openItem: (id: string) => void;
  /** Opens "add": for a room (null = no room yet), optionally as an alternative, with links already filled in. */
  openAdd: (opts?: { roomId?: string | null; alternativeOf?: string; links?: string[] }) => void;
  toast: (text: string, undo?: () => void) => void;
  /** fal.ai is set up: the ✨ features are available. */
  fal: boolean;
}

export const AppContext = createContext<App | null>(null);
export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp outside the app");
  return app;
}
