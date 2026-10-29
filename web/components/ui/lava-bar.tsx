"use client";

/**
 * The lava navigation, v3: ONE canvas behind the whole nav bar — a flowing
 * value-noise field (fBm with domain warp) sampled on a small blocky grid.
 * The warp folds the field through two more noise fields so it swirls and
 * oozes instead of scrolling in bands; hue comes from its own low-frequency
 * field so neighbouring regions hold genuinely different colours; per-cell
 * jitter reshuffles every few frames for a slow organic shimmer. Rendered
 * dark and at low opacity: texture, not brightness.
 *
 * Performance rules (it must cost nothing):
 *  - one tiny canvas (~168x12 cells) stretched with image-rendering:
 *    pixelated, capped at ~10 fps;
 *  - pauses entirely when the tab is hidden or the nav is off-screen
 *    (visibilitychange + IntersectionObserver);
 *  - phase follows scroll/pointer, so it still slides when you move;
 *  - prefers-reduced-motion renders a single static frame and stops.
 */

import { useEffect, useRef } from "react";

const CELLS_X = 168;
const CELLS_Y = 12;
const FRAME_MS = 96;
const HUE_BASE = 170;
const HUE_SPAN = 165; // regional hue field — neighbouring areas differ
const SAT: [number, number] = [42, 58];
const LIG: [number, number] = [30, 48];
const DEEP_LIG = 22;

/* -- deterministic value noise (no allocations in the frame loop) -------- */
const hash = (x: number, y: number, s: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const vnoise = (x: number, y: number, s: number): number => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x: number, y: number, s: number): number =>
  0.5 * vnoise(x, y, s) + 0.3 * vnoise(x * 2.13, y * 2.13, s + 7) + 0.2 * vnoise(x * 4.71, y * 4.71, s + 13);

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
      const jit = frame >> 3; // reshuffles every 8 frames: shimmer, no flicker
      for (let y = 0; y < CELLS_Y; y++) {
        const ny = y * 0.34;
        for (let x = 0; x < CELLS_X; x++) {
          const sx = x * 0.062 - time * 0.045 + shift;
          // domain warp: fold the coords through two more fields — the flow
          const wx = fbm(sx * 1.6 + time * 0.032, ny * 1.6, 31) - 0.5;
          const wy = fbm(sx * 1.6 - time * 0.041, ny * 1.6 + 5, 57) - 0.5;
          const px = sx + wx * 1.5;
          const py = ny + wy * 1.1;
          const h = fbm(px, py, 3);
          const hueN = fbm(sx * 0.42 - time * 0.011, ny * 0.8 + 9, 83);
          const deep = fbm(px * 0.8, py * 0.8, 97);
          const j = hash(x, y, jit) - 0.5;
          let lig = LIG[0] + (LIG[1] - LIG[0]) * (h * h * (3 - 2 * h)) + j * 3;
          if (deep < 0.17) lig = DEEP_LIG + j * 2;
          const hue = HUE_BASE + (hueN - 0.5) * HUE_SPAN + (h - 0.5) * 26 + j * 9;
          const sat = SAT[0] + (SAT[1] - SAT[0]) * h + j * 8;
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
      className="absolute inset-0 w-full h-full [image-rendering:pixelated] opacity-30 select-none" />
  );
}
