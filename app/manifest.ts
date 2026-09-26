import type { MetadataRoute } from "next";

/** Installable on iPad/iPhone/Android ("Zet op beginscherm"): full screen, and Safari keeps the data. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "furnuture — richt je nieuwe huis in",
    short_name: "furnuture",
    description: "Plak je Funda-link, verzamel meubels, vloeren en verf, en zie ze in je nieuwe kamers.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f5f2",
    theme_color: "#e9601f",
    lang: "nl",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
