"use client";

/**
 * The lava field: slowly drifting blocks of colour rendered on a tiny canvas
 * (one cell per block) and stretched with image-rendering: pixelated — chunky
 * pixels, never a smooth gradient. The hue field is layered sines; bands
 * slither and roll, lava-lamp slow, and the phase follows page movement
 * (scroll + pointer) so it feels like it slides along when you move.
 *
 * Two shapes share this file:
 *  - <LavaBar />  the strip above the nav: pastel, wide blocks, very slow.
 *  - <LavaPill /> the ACTIVE nav pill's background: fewer, chunkier cells,
 *    deeper colours with occasional dark flashes, a touch quicker.
 * Reduced motion renders a single static frame.
 */

import { useEffect, useRef } from "react";

type FieldOpts = {
  cellsX: number;
  cellsY: number;
  frameMs: number;
  baseHue: number;
  hueSpan: number;
  sat: [number, number];
  lig: [number, number];
  /** occasional deep flashes: every ~N frames one cell dips to deepLig */
  deepEvery?: number;
  deepLig?: number;
};

const BAR: FieldOpts = { cellsX: 72, cellsY: 5, frameMs: 140, baseHue: 195, hueSpan: 52,
  sat: [40, 52], lig: [72, 84], deepEvery: 9, deepLig: 52 };
const PILL: FieldOpts = { cellsX: 22, cellsY: 3, frameMs: 110, baseHue: 165, hueSpan: 130,
  sat: [45, 62], lig: [55, 74], deepEvery: 6, deepLig: 38 };

function useLavaField(ref: React.RefObject<HTMLCanvasElement | null>, o: FieldOpts) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = o.cellsX;
    canvas.height = o.cellsY;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let frame = 0;
    const drift = { scroll: 0, px: 0 };

    const draw = (t: number) => {
      const time = t / 1000;
      frame++;
      const shift = drift.scroll * 0.0035 + drift.px * 0.0022;
      for (let y = 0; y < o.cellsY; y++) {
        for (let x = 0; x < o.cellsX; x++) {
          const wave = Math.sin(x * 0.19 + time * 0.21 + shift)
            + Math.sin(x * 0.07 - time * 0.13 - shift * 1.4 + Math.sin(time * 0.07) * 2)
            + Math.sin((x + y * 22) * 0.11 + time * 0.09 + shift * 0.6);
          let lig = o.lig[0] + (o.lig[1] - o.lig[0]) * (0.5 + 0.5 * Math.sin(y * 1.7 + time * 0.11 + x * 0.05));
          // the occasional deep flash: sparse, deterministic per cell+frame
          if (o.deepEvery && ((x * 7 + y * 13 + frame) % (o.deepEvery * o.cellsX)) === 0) lig = o.deepLig!;
          const hue = o.baseHue + wave * o.hueSpan * 0.5 + y * 6;
          const sat = o.sat[0] + (o.sat[1] - o.sat[0]) * (0.5 + 0.5 * Math.sin(x * 0.3 + time * 0.05));
          ctx.fillStyle = `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${lig.toFixed(0)}%)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    const loop = (t: number) => {
      if (t - last >= o.frameMs) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      draw(0);
    } else {
      const onScroll = () => { drift.scroll = window.scrollY; };
      const onMove = (e: PointerEvent) => { drift.px = e.clientX / Math.max(1, window.innerWidth); };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      raf = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("pointermove", onMove);
      };
    }
  }, [ref, o.cellsX, o.cellsY, o.frameMs]);
}

export function LavaBar({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLavaField(ref, BAR);
  return (
    <canvas ref={ref} aria-hidden="true"
      className={`block w-full h-[10px] [image-rendering:pixelated] select-none ${className}`} />
  );
}

/** Background for the active nav pill: chunkier, deeper, slightly quicker. */
export function LavaPill() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLavaField(ref, PILL);
  return (
    <canvas ref={ref} aria-hidden="true"
      className="absolute inset-0 w-full h-full rounded-full [image-rendering:pixelated] opacity-80" />
  );
}
