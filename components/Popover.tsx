"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  // Rendered as the clickable trigger — typically an icon button.
  trigger: ReactNode;
  triggerLabel: string;
  triggerTitle?: string;
  children: ReactNode;
  disabled?: boolean;
}

// A small, self-positioning popover: click the trigger to open a floating
// panel anchored to it, closing on outside click, Escape, or scroll. Built
// for exactly one job — showing a table/list row's full detail (e.g. a DIM
// point's complete Beschreibung/Bemerkung, which can run to a dozen dated
// entries) without permanently spending that row's height on it, and without
// the delay and plain-text limits of a native `title` tooltip.
//
// Rendered via a portal to `document.body` rather than in place: the DIM
// point list scrolls inside its own `overflow: auto` container, which would
// clip an in-place absolutely/fixed-positioned panel. A portal sidesteps that
// regardless of how deep the trigger sits in scrolling ancestors.
export default function Popover({ trigger, triggerLabel, triggerTitle, children, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const PANEL_W = 320;
    const PANEL_MAX_H = 280;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const openUp = r.bottom + PANEL_MAX_H > window.innerHeight && r.top > PANEL_MAX_H;
      setPos({
        top: openUp ? r.top : r.bottom,
        left: Math.min(Math.max(8, r.left), window.innerWidth - PANEL_W - 8),
        openUp,
      });
    };
    place();

    const close = () => setOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    // Any scroll (the page, or the list's own scroll container) moves the
    // trigger — closing rather than re-tracking keeps this simple and avoids
    // a stale panel drifting away from its anchor.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        disabled={disabled}
        aria-label={triggerLabel}
        aria-expanded={open}
        title={triggerTitle ?? triggerLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{ width: 26, height: 22, fontSize: 12, flex: "0 0 auto" }}
      >
        {trigger}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={triggerLabel}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pos.openUp ? undefined : pos.top + 4,
              bottom: pos.openUp ? window.innerHeight - pos.top + 4 : undefined,
              left: pos.left,
              width: 320,
              maxHeight: 280,
              overflowY: "auto",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              padding: 12,
              zIndex: 200,
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
