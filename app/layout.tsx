import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "furnuture – inkoopplanner voor je nieuwe huis",
  description: "Plak je Funda-link en plan per kamer wat je gaat kopen: prijzen, budget en een overzicht per winkel.",
  appleWebApp: { capable: true, title: "furnuture", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#141210" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <head>
        {/* Playfair Display (headings) + Inter (UI): see design-system/furnuture/MASTER.md */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
