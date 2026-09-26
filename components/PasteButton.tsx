"use client";

import { useEffect, useState } from "react";

/** One tap to paste a copied link — much easier than long-press → Plakken on an iPad. */
export function PasteButton({ onPaste, label = "📋 Plak" }: { onPaste: (text: string) => void; label?: string }) {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(typeof navigator !== "undefined" && !!navigator.clipboard?.readText), []);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (text) onPaste(text);
        } catch {
          // permission refused: the user can still paste by hand
        }
      }}
    >
      {label}
    </button>
  );
}
