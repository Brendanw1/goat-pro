"use client";

/**
 * The lava bar: a thin strip of slowly drifting pastel blocks along the very
 * top of the site. Rendered on a tiny canvas (one cell per block) and stretched
 * with image-rendering: pixelated, so it reads as chunky pixels rather than a
 * smooth gradient. The hue field is layered sines — bands slither horizontally
 * and roll vertically, lava-lamp slow — and the whole field's phase follows
 * page movement (scroll + pointer), so it feels like it slides along when you
 * move. Reduced motion renders one static frame.
 */

import { useEffect, useRef } from "react";

const CELLS_X = 96;
const CELLS_Y = 5;
const FRAME_MS = 66; // ~15fps: slow lava doesn't need more

export function LavaBar({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drift = useRef({ scroll: 0, px: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = CELLS_X;
    canvas.height = CELLS_Y;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;

    const draw = (t: number) => {
      const time = t / 1000;
      const d = drift.current;
      const shift = d.scroll * 0.0035 + d.px * 0.0022;
      for (let y = 0; y < CELLS_Y; y++) {
        for (let x = 0; x < CELLS_X; x++) {
          // two slow travelling waves + a vertical roll; pastel = low
          // saturation, high lightness, hue sweeping a wide band
          const wave = Math.sin(x * 0.19 + time * 0.21 + shift)
            + Math.sin(x * 0.07 - time * 0.13 - shift * 1.4 + Math.sin(time * 0.07) * 2)
            + Math.sin((x + y * 22) * 0.11 + time * 0.09 + shift * 0.6);
          const hue = 190 + wave * 55 + y * 6;
          const sat = 42 + Math.sin(x * 0.3 + time * 0.05) * 8;
          const lig = 74 + Math.sin(y * 1.7 + time * 0.11 + x * 0.05) * 9;
          ctx.fillStyle = `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${lig.toFixed(0)}%)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    const loop = (t: number) => {
      if (t - last >= FRAME_MS) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      draw(0);
    } else {
      const onScroll = () => {
        drift.current.scroll = window.scrollY;
      };
      const onMove = (e: PointerEvent) => {
        drift.current.px = e.clientX / Math.max(1, window.innerWidth);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      raf = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("pointermove", onMove);
      };
    }
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`block w-full h-[10px] [image-rendering:pixelated] select-none ${className}`}
    />
  );
}
