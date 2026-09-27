import type { MetadataRoute } from "next";

/** Installable on iPad/iPhone/Android ("Zet op beginscherm"): full screen, and Safari keeps the data. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "furnuture — inkoopplanner voor je nieuwe huis",
    short_name: "furnuture",
    description: "Plak je Funda-link en plan per kamer wat je gaat kopen: prijzen, budget en een overzicht per winkel.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f3ee",
    theme_color: "#1f6f5c",
    lang: "nl",
    // Share a shop link from another app straight to the list (Android; iOS has no share target for web apps).
    share_target: { action: "/", method: "GET", params: { title: "title", text: "text", url: "url" } },
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
