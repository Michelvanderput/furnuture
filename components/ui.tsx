"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { euro, statusLabel, type Totals } from "@/lib/shopping";
import type { ItemStatus } from "@/lib/types";
import { CaretLeft, CaretRight, MagnifyingGlass, Minus, Plus, X } from "@phosphor-icons/react";
import { I, STATUS_ICON } from "./icons";
import { Img } from "./Img";

/** A dialog: a bottom sheet on phones, a centred card on bigger screens. Esc or a tap outside closes it. */
/**
 * Keeps the page behind a dialog still. On iOS "overflow: hidden" on the body is not
 * enough (the page scrolls and the dialog jumps); fixing the body in place is. Nested
 * dialogs share one lock.
 */
let locks = 0;
let savedY = 0;
function lockScroll(): () => void {
  if (locks++ === 0) {
    savedY = window.scrollY;
    const b = document.body.style;
    b.position = "fixed";
    b.top = `-${savedY}px`;
    b.left = "0";
    b.right = "0";
    b.overflow = "hidden";
  }
  return () => {
    if (--locks > 0) return;
    const b = document.body.style;
    b.position = b.top = b.left = b.right = b.overflow = "";
    window.scrollTo(0, savedY);
  };
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  // The latest onClose, without re-running the effects below on every render.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    const unlock = lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, []);
  // Drawn at the end of <body>: a dialog opened from the header (the bell) is not
  // trapped under the header's layer, below the "+" button.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Sluiten">
            <I icon={X} size={20} />
          </button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Spent / planned (estimated part striped) against a budget. */
export function BudgetBar({ totals, budget }: { totals: Totals; budget?: number }) {
  const max = Math.max(budget ?? 0, totals.planned, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;
  const firm = totals.planned - totals.estimated - totals.spent;
  const over = !!budget && totals.planned > budget;
  return (
    <div className={`bar${over ? " over" : ""}`} title={budget ? `${euro(totals.planned)} van ${euro(budget)}` : euro(totals.planned)}>
      <span className="spent" style={{ width: pct(totals.spent) }} />
      <span className="planned" style={{ width: pct(Math.max(0, firm)) }} />
      <span className="estimated" style={{ width: pct(totals.estimated) }} />
    </div>
  );
}

export function Ring({ pct, over, children }: { pct: number; over?: boolean; children: React.ReactNode }) {
  return (
    <div className={`ring${over ? " over" : ""}`} style={{ "--p": Math.max(0, Math.min(100, pct)) } as React.CSSProperties}>
      <div>{children}</div>
    </div>
  );
}

export function StatusPill({ status, onClick }: { status: ItemStatus; onClick?: () => void }) {
  const s = statusLabel(status);
  const content = (
    <>
      <I icon={STATUS_ICON[status]} size={14} weight="bold" />
      {s.label}
    </>
  );
  return onClick ? (
    <button className={`chip status status-${status}`} onClick={onClick} title="Tik voor de volgende stap" aria-label={`Status: ${s.label}. Tik voor de volgende stap`}>
      {content}
    </button>
  ) : (
    <span className={`chip status status-${status}`}>{content}</span>
  );
}

export function Stepper({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Minder" disabled={value <= min}>
        <I icon={Minus} size={16} weight="bold" />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label="Meer">
        <I icon={Plus} size={16} weight="bold" />
      </button>
    </span>
  );
}

/** Euro input that shows "1.299" and gives a number (or undefined when empty). */
export function EuroInput({ value, onChange, placeholder }: { value?: number; onChange: (n: number | undefined) => void; placeholder?: string }) {
  const [text, setText] = useState(value === undefined ? "" : String(value).replace(".", ","));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) setText(value === undefined ? "" : String(value).replace(".", ","));
    last.current = value;
  }, [value]);
  return (
    <span className="input-euro">
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value.replace(/\./g, "").replace(",", "."));
          last.current = Number.isFinite(n) && n >= 0 ? n : undefined;
          onChange(last.current);
        }}
      />
    </span>
  );
}

/** Full-screen photo viewer with previous/next (arrow keys too). */
export function Lightbox({ photos, index, onClose }: { photos: string[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((n) => (n + 1) % photos.length);
      if (e.key === "ArrowLeft") setI((n) => (n - 1 + photos.length) % photos.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Foto ${i + 1} van ${photos.length}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Img src={photos[i]} width={1440} alt={`Foto ${i + 1} van ${photos.length}`} />
      <button className="close" onClick={onClose} aria-label="Sluiten" autoFocus>
        <I icon={X} size={22} />
      </button>
      {photos.length > 1 && (
        <>
          <button className="nav prev" onClick={() => setI((n) => (n - 1 + photos.length) % photos.length)} aria-label="Vorige foto">
            <I icon={CaretLeft} size={22} />
          </button>
          <button className="nav next" onClick={() => setI((n) => (n + 1) % photos.length)} aria-label="Volgende foto">
            <I icon={CaretRight} size={22} />
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts with undo

/** A second button next to "Ongedaan maken", e.g. "Als optie". */
export type ToastAction = { label: string; run: () => void };
type Toast = { text: string; undo?: () => void; action?: ToastAction; id: number };
const ToastContext = createContext<(text: string, undo?: () => void, action?: ToastAction) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, undo?: () => void, action?: ToastAction) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ text, undo, action, id });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 9000 : undo ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo!();
                setToast(null);
              }}
            >
              Ongedaan maken
            </button>
          )}
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Shop favicon (Google's favicon service), with the first letter while it loads or when it fails. */
export function ShopLogo({ url, shop }: { url?: string; shop: string }) {
  const [failed, setFailed] = useState(false);
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    // no logo
  }
  if (shop === "Nog te vinden")
    return (
      <span className="shop-logo" style={{ color: "var(--estimate)", background: "var(--estimate-tint)" }}>
        <I icon={MagnifyingGlass} size={20} />
      </span>
    );
  return (
    <span className="shop-logo">
      {host && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} alt="" onError={() => setFailed(true)} />
      ) : (
        <b>{shop.slice(0, 1).toUpperCase()}</b>
      )}
    </span>
  );
}
