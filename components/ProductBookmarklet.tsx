"use client";

import { BookmarkSimple, Copy } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { bookmarkletUrl } from "@/lib/bookmarklet";
import { I } from "./icons";

/**
 * For shops that block reading their pages from a server (Karwei, GAMMA, bol…): a
 * bookmark that runs on the product page in your own browser, where the shop's check
 * passes, and brings name, price and photo to the app (#product={u,t,p,i}, read in
 * app/page.tsx).
 */
export function ProductBookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const url = bookmarkletUrl(window.location.origin);
    setCode(url);
    // React refuses javascript: URLs in JSX, so set it directly.
    ref.current?.setAttribute("href", url);
  }, []);
  return (
    <>
      <a
        ref={ref}
        className="chip accent"
        onClick={(e) => {
          e.preventDefault();
          alert("Sleep deze knop naar je bladwijzerbalk. Open daarna een product in de webshop en klik op de bladwijzer \"Product naar furnuture\".");
        }}
      >
        <I icon={BookmarkSimple} size={14} /> Product naar furnuture
      </a>{" "}
      <button
        type="button"
        className="chip"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            prompt("Kopieer deze code:", code);
          }
        }}
      >
        <I icon={Copy} size={14} /> {copied ? "Gekopieerd" : "Kopieer code (iPhone/iPad)"}
      </button>
      {copied && (
        <span className="tiny muted" style={{ display: "block", marginTop: 6 }}>
          In Safari: maak een bladwijzer van een willekeurige pagina (Deel → Voeg bladwijzer toe) en noem hem &quot;Product naar furnuture&quot;. Open
          Bladwijzers → Wijzig → tik op die bladwijzer en plak de code als adres. Op een productpagina: tik in de adresbalk, typ &quot;Product&quot; en kies de
          bladwijzer.
        </span>
      )}
    </>
  );
}

/** A product sent by the bookmarklet, if the page was opened with one. */
export function productFromHash(): { url: string; title: string; price?: string; image?: string; error?: string } | null {
  if (typeof location === "undefined" || !location.hash.startsWith("#product=")) return null;
  try {
    const d = JSON.parse(decodeURIComponent(location.hash.slice(9))) as { u?: string; t?: string; p?: string; i?: string; e?: string };
    if (!d.u || !/^https?:\/\//.test(d.u)) return null;
    return { url: d.u, title: String(d.t ?? "").trim().slice(0, 200), price: d.p || undefined, image: d.i && /^https?:\/\//.test(d.i) ? d.i : undefined, error: d.e ? String(d.e).slice(0, 200) : undefined };
  } catch {
    return null;
  }
}
