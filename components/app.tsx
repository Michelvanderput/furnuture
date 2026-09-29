"use client";

import { createContext, useContext } from "react";
import type { HouseRef } from "@/lib/houses";
import type { Project } from "@/lib/types";
import type { ToastAction } from "./ui";
import type { SyncState } from "@/lib/useProject";

export interface App {
  /** The open house (its name, and its id in the database when it is stored online). */
  house: HouseRef;
  sync: SyncState;
  syncError: string;
  /** Back to the name screen. */
  leave: () => void;
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  /** Opens an item's details. */
  openItem: (id: string) => void;
  /** Opens "add": for a room (null = no room yet), optionally as an alternative, with links already filled in. */
  openAdd: (opts?: { roomId?: string | null; alternativeOf?: string; links?: string[] }) => void;
  /** Opens a renovation job. */
  openTask: (id: string) => void;
  /** Opens the settings (budget, notifications…). */
  openSettings: () => void;
  toast: (text: string, undo?: () => void, action?: ToastAction) => void;
}

export const AppContext = createContext<App | null>(null);
export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp outside the app");
  return app;
}
