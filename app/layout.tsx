import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Furnuture – richt je nieuwe huis in",
  description: "Plak je Funda-link, verzamel meubels, vloeren en verf, en zie ze in je nieuwe kamers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
