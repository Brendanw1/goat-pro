"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One tooltip for the whole app, replacing the browser's own `title` bubble
 * (grey, plain, ~1s delay). Any element with `title="..."` or, inside SVGs,
 * `data-tip="..."` gets it; nothing else changes and the text is exactly what
 * the element already carried.
 *
 * `title` is lifted off the element only while it is hovered or focused (so the
 * native bubble never fires) and put back on leave, so React's view of the DOM
 * never drifts. If React rewrote the title mid-hover, the new value is kept.
 *
 * On scroll the tip follows its element rather than vanishing under the cursor.
 *
 * Speed: 60ms to appear (long enough that sweeping across a table doesn't
 * flash every cell), instant while moving between tips.
 */
const DELAY = 60;
const WARM_MS = 400;
const SEL = "[title]:not(iframe):not(link):not(style),[data-tip]";

/** `host`: an open <dialog> sits in the top layer above everything, so a tip inside one renders into it. */
interface Tip { lines: string[]; x: number; y: number; below: boolean; host: Element }

/** "a · b · c" reads as a heading and its detail lines. Plain text stays one block. */
export function tipLines(text: string): string[] {
  const parts = text.split(/\s+·\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : [text.trim()];
}

export function HoverTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const lastHide = useRef(0);

  useEffect(() => {
    let current: Element | null = null;
    let lifted: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let place: (() => void) | null = null;   // re-measures the current tip (scroll follows the element)

    const release = () => {
      clearTimeout(timer);
      if (current && lifted !== null && !current.hasAttribute("title")) current.setAttribute("title", lifted);
      if (current) lastHide.current = Date.now();
      current = null;
      lifted = null;
      place = null;
      setTip(null);
    };

    const open = (el: Element) => {
      if (el === current) return;
      release();
      const title = el.getAttribute("title");
      // SVG marks carry their text once, as the accessible name: role="img" aria-label="..." data-tip.
      const text = title ?? (el.getAttribute("data-tip") || el.getAttribute("aria-label"));
      if (!text || !text.trim()) return;
      current = el;
      if (title !== null) {
        lifted = title;
        el.removeAttribute("title");
      }
      const show = () => {
        if (current !== el) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 90;
        setTip({ lines: tipLines(text), x: r.left + r.width / 2, y: below ? r.bottom : r.top, below, host: el.closest("dialog[open]") ?? document.body });
      };
      place = show;
      if (Date.now() - lastHide.current < WARM_MS) show();
      else timer = setTimeout(show, DELAY);
    };

    const target = (e: Event) => (e.target instanceof Element ? e.target.closest(SEL) : null);
    const onOver = (e: PointerEvent) => { const el = target(e); if (el) open(el); else if (current) release(); };
    const onOut = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest(SEL) : null;
      if (to !== current) release();
    };
    const onFocus = (e: FocusEvent) => { const el = target(e); if (el) open(el); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") release(); };
    const onScroll = () => {
      if (!current) return;
      if (!current.isConnected) release(); else place?.();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", release);
    document.addEventListener("pointerdown", release);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      release();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", release);
      document.removeEventListener("pointerdown", release);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  if (!tip) return null;
  // Keep the panel on screen: clamp the anchor, then centre on it.
  const x = Math.min(Math.max(tip.x, 170), (typeof window !== "undefined" ? window.innerWidth : 1200) - 170);
  return createPortal(
    <div role="tooltip" className="tip-panel tip-float" data-below={tip.below ? "" : undefined}
         style={{ left: x, top: tip.y }}>
      {tip.lines.length > 1 ? (
        <>
          <div className="tip-head">{tip.lines[0]}</div>
          {tip.lines.slice(1).map((l, i) => <div key={i} className="tip-line">{l}</div>)}
        </>
      ) : (
        <div className="tip-line">{tip.lines[0]}</div>
      )}
    </div>,
    tip.host,
  );
}
