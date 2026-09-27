"use client";

import { useEffect, useState } from "react";

/** Views of the app, kept in the URL hash so the back button and a reload work. */
export type Route =
  | { view: "overzicht" }
  | { view: "kamers" }
  | { view: "kamer"; id: string }
  | { view: "verbouwing" }
  | { view: "winkelen" }
  | { view: "woning" };

export function parseRoute(hash: string): Route {
  const [, view, id] = hash.replace(/^#/, "").split("/");
  if (view === "kamer" && id) return { view: "kamer", id: decodeURIComponent(id) };
  if (view === "kamers" || view === "verbouwing" || view === "winkelen" || view === "woning") return { view };
  return { view: "overzicht" };
}

export const href = (r: Route) => (r.view === "kamer" ? `#/kamer/${encodeURIComponent(r.id)}` : r.view === "overzicht" ? "#/" : `#/${r.view}`);

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>({ view: "overzicht" });
  useEffect(() => {
    const read = () => {
      // The bookmarklet's #import=… is read by the welcome screen, not a route.
      if (location.hash.startsWith("#import=")) return;
      setRoute(parseRoute(location.hash));
      window.scrollTo({ top: 0 });
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return route;
}

export const go = (r: Route) => {
  location.hash = href(r);
};
