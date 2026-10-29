"use client";

/**
 * The lava navigation: ONE canvas behind the whole nav bar — the field the
 * header lives on. Small blocky cells stretched with image-rendering:
 * pixelated, the site's pastel sweep dropped darker, at low opacity so it
 * reads as texture, not brightness. The active pill is no separate element:
 * it reads as a window highlighted out of the field (bold text on a soft
 * dark backdrop). The GOAT-Pro brand sits in a white shader circle on top.
 *
 * Performance rules (it must cost nothing):
 *  - one canvas for the entire header, ~150x10 cells, capped at ~9 fps;
 *  - pauses entirely when the tab is hidden or the nav is off-screen
 *    (visibilitychange + IntersectionObserver);
 *  - phase follows scroll/pointer, so it still slides when you move;
 *  - prefers-reduced-motion renders a single static frame and stops.
 */

import { useEffect, useRef } from "react";

const CELLS_X = 150;
const CELLS_Y = 10;
const FRAME_MS = 110;
const HUE_BASE = 178;
const HUE_SPAN = 118;
const SAT: [number, number] = [46, 60];
const LIG: [number, number] = [38, 56];
const DEEP_LIG = 28;
const DEEP_EVERY = 13;

export function LavaNav() {
  const ref = useRef<HTMLCanvasElement>(null);
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
    let frame = 0;
    let visible = true;
    let inView = true;
    let pxShift = 0;
    let scrollShift = 0;

    const draw = (t: number) => {
      frame++;
      const time = t / 1000;
      const shift = scrollShift + pxShift;
      for (let y = 0; y < CELLS_Y; y++) {
        for (let x = 0; x < CELLS_X; x++) {
          const wave = Math.sin(x * 0.19 + time * 0.21 + shift)
            + Math.sin(x * 0.07 - time * 0.13 - shift * 1.4 + Math.sin(time * 0.07) * 2)
            + Math.sin((x + y * 14) * 0.11 + time * 0.09 + shift * 0.6);
          let lig = LIG[0] + (LIG[1] - LIG[0]) * (0.5 + 0.5 * Math.sin(y * 1.3 + time * 0.11 + x * 0.05));
          if ((x * 7 + y * 13 + frame) % (DEEP_EVERY * CELLS_X) === 0) lig = DEEP_LIG;
          const hue = HUE_BASE + wave * HUE_SPAN * 0.5 + (y / CELLS_Y) * 12;
          const sat = SAT[0] + (SAT[1] - SAT[0]) * (0.5 + 0.5 * Math.sin(x * 0.3 + time * 0.05));
          ctx.fillStyle = `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${lig.toFixed(0)}%)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    const loop = (t: number) => {
      if (visible && inView && t - last >= FRAME_MS) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      draw(0);
      return;
    }
    const onVis = () => { visible = !document.hidden; };
    const onScroll = () => { scrollShift = window.scrollY * 0.0035; };
    const onMove = (e: PointerEvent) => { pxShift = (e.clientX / Math.max(1, window.innerWidth)) * 2.2; };
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden="true"
      className="absolute inset-0 w-full h-full [image-rendering:pixelated] opacity-40 select-none" />
  );
}
