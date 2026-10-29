"use client";

/**
 * The lava navigation, v6: ONE canvas behind the whole nav bar — a flowing
 * value-noise field (fBm with domain warp). The warp folds the field through
 * two more noise fields so it swirls and oozes; hue comes from its own
 * low-frequency field so neighbouring regions hold different colours, and
 * the base hue rolls slowly round the wheel. Rendered dark and at low
 * opacity: texture, not brightness.
 *
 * v6 (polish): the field is computed on a tiny grid (~1 cell per 16 css px,
 * 8 rows) and the browser upscales it with bilinear smoothing, so it reads
 * as soft gradients instead of blocks at ~1/4 of v4's cell count. Lattice
 * noise comes from precomputed tables (no hashing in the loop), motion is
 * purely time-based (even at any frame rate), scroll/pointer phase is eased
 * instead of snapping, and the per-cell shimmer is gone (it was grain).
 *
 * Performance rules (it must cost nothing):
 *  - ~30 fps cap; no allocations per frame (one ImageData, packed pixels);
 *  - the rAF loop stops entirely when the tab is hidden or the nav is
 *    off-screen (visibilitychange + IntersectionObserver), not just skips;
 *  - prefers-reduced-motion renders a single static frame and stops.
 *
 * v7 (owner ask): hovering the bar RAISES the surface under the cursor
 * (lighter, richer, soft falloff) and the raise trails the pointer with
 * easing, dragging the texture along the way you move. Clicking a tab drops
 * it; it re-arms once the pointer leaves the bar. Cost: one multiply-add per
 * cell inside the existing 30 fps draw, falloff rows precomputed per frame,
 * no listeners beyond the pointermove already here.
 */

import { useEffect, useRef } from "react";

const CELL_PX = 16; // css px per field cell (the browser smooths between)
const CELLS_Y = 8;
const FRAME_MS = 33; // ~30 fps cap
const HUE_BASE = 170;
const HUE_DRIFT = 0.9; // deg/s — the base hue laps the wheel every ~7 minutes
const HUE_SPAN = 120; // regional hue field — neighbouring areas differ
const SAT: [number, number] = [34, 50];
const LIG: [number, number] = [26, 46];
const EASE_S = 0.9; // seconds for scroll/pointer phase to settle
const RAISE_R = 5.5; // raise radius, cells (gaussian sigma across)
const RAISE_LIG = 46; // lightness points at the peak
const RAISE_SAT = 30; // saturation points at the peak
const PULL = 0.55; // how far the trail drags the texture (fraction of the lag)
const FOLLOW_S = 0.16; // seconds for the raise to catch the cursor
const ALPHA = 77; // the field's resting opacity (~0.3), carried per pixel so the raise can lift it
const RAISE_ALPHA = 90; // extra opacity at the raise's peak

/* -- table value noise: 256 lattice values + a permutation, built once ---- */
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  let s = 0x9e3779b9;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
  for (let i = 0; i < 256; i++) { PERM[i] = i; VAL[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = PERM[i]; PERM[i] = PERM[j]; PERM[j] = t; }
  for (let i = 0; i < 256; i++) PERM[i + 256] = PERM[i];
}
const vnoise = (x: number, y: number): number => {
  const fx = Math.floor(x), fy = Math.floor(y);
  const xf = x - fx, yf = y - fy;
  const xi = fx & 255, yi = fy & 255;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const p0 = PERM[xi], p1 = PERM[xi + 1];
  const a = VAL[PERM[p0 + yi]], b = VAL[PERM[p1 + yi]];
  const c = VAL[PERM[p0 + yi + 1]], d = VAL[PERM[p1 + yi + 1]];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
// seeds are coordinate offsets (decorrelates the fields without a hash)
const fbm = (x: number, y: number, s: number): number =>
  0.5 * vnoise(x + s, y - s) + 0.3 * vnoise(x * 2.13 + s, y * 2.13 + s) + 0.2 * vnoise(x * 4.71 - s, y * 4.71 + s);

/* -- hsl (0-360, 0-1, 0-1) + alpha (0-255) to a packed ABGR pixel (little-endian) */
const packHsl = (h: number, s: number, l: number, a: number): number => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const R = ((r + m) * 255) | 0, G = ((g + m) * 255) | 0, B = ((b + m) * 255) | 0;
  return (a << 24) | (B << 16) | (G << 8) | R;
};
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function LavaNav() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cellsX = 0;
    let img!: ImageData;
    let buf!: Uint32Array;
    let fallX = new Float32Array(0); // per-column raise falloff, refilled per frame
    // grid width follows the nav's css width so cells stay ~square at any
    // viewport; reallocated only on resize, never per frame
    const fit = () => {
      const n = Math.max(24, Math.min(160, Math.ceil(canvas.clientWidth / CELL_PX)));
      if (n === cellsX) return false;
      cellsX = canvas.width = n;
      canvas.height = CELLS_Y;
      img = ctx.createImageData(cellsX, CELLS_Y);
      buf = new Uint32Array(img.data.buffer);
      fallX = new Float32Array(cellsX);
      return true;
    };
    fit();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let shift = 0;
    let target = 0;
    let scrollT = 0;
    let pointerT = 0;
    // field coords: x step chosen so a cell spans the same field distance as
    // v4's (0.062 per 7.5px cell) — the shapes keep their size on screen
    const SX = 0.062 * (CELL_PX / 7.5);
    const SY = 0.34 * (13 / CELLS_Y);
    // the raise: cursor cell (cx, cy), its eased trail (ex, ey), and lift 0..1
    let cx = 0, cy = 0, ex = 0, ey = 0, lift = 0;
    let hover = false, armed = true;
    const fallY = new Float32Array(CELLS_Y);

    const draw = (t: number) => {
      const time = t / 1000;
      const raised = lift > 0.002;
      const lag = Math.max(-12, Math.min(12, cx - ex));
      if (raised) {
        for (let x = 0; x < cellsX; x++) { const d = (x - ex) / RAISE_R; fallX[x] = Math.exp(-d * d); }
        for (let y = 0; y < CELLS_Y; y++) { const d = (y - ey) / (CELLS_Y * 0.6); fallY[y] = Math.exp(-d * d); }
      }
      let i = 0;
      for (let y = 0; y < CELLS_Y; y++) {
        const ny = y * SY;
        for (let x = 0; x < cellsX; x++, i++) {
          const f = raised ? lift * fallX[x] * fallY[y] : 0;
          // the pull: sample from behind the motion so the texture drags with the cursor
          const sx = x * SX - time * 0.03 + shift - f * lag * SX * PULL;
          // domain warp: fold the coords through two more fields — the flow
          const wx = fbm(sx * 1.6 + time * 0.022, ny * 1.6, 31) - 0.5;
          const wy = fbm(sx * 1.6 - time * 0.027, ny * 1.6 + 5, 57) - 0.5;
          const px = sx + wx * 1.5;
          const py = ny + wy * 1.1;
          const h = fbm(px, py, 3);
          const hueN = fbm(sx * 0.42 - time * 0.008, ny * 0.8 + 9, 83);
          const deep = fbm(px * 0.8, py * 0.8, 97);
          // soft dark pools where the deep field is low, no hard edge
          const lig = (LIG[0] + (LIG[1] - LIG[0]) * smooth(h) - 8 * (1 - smooth((deep - 0.1) / 0.2)) + f * RAISE_LIG * (0.6 + 0.4 * h)) / 100;
          const hue = HUE_BASE + time * HUE_DRIFT + (hueN - 0.5) * HUE_SPAN + (h - 0.5) * 20;
          const sat = (SAT[0] + (SAT[1] - SAT[0]) * h + f * RAISE_SAT) / 100;
          buf[i] = packHsl(hue, sat, Math.min(0.9, lig), (ALPHA + f * RAISE_ALPHA) | 0);
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    if (reduced) {
      draw(0);
      const onResize = () => { if (fit()) draw(0); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    let visible = !document.hidden;
    let inView = true;
    const loop = (t: number) => {
      raf = 0;
      if (!visible || !inView) return; // stopped; resumes via start()
      const dt = last ? Math.min(0.25, (t - last) / 1000) : 0;
      if (!last || t - last >= FRAME_MS) {
        last = t;
        target = scrollT + pointerT;
        shift += (target - shift) * (1 - Math.exp(-dt / EASE_S * 3));
        const k = 1 - Math.exp(-dt / FOLLOW_S);
        ex += (cx - ex) * k;
        ey += (cy - ey) * k;
        // rises fast, settles slowly
        const on = hover && armed ? 1 : 0;
        lift += (on - lift) * (1 - Math.exp(-dt / (on ? 0.22 : 0.6)));
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && visible && inView) { last = 0; raf = requestAnimationFrame(loop); }
    };
    const onVis = () => { visible = !document.hidden; start(); };
    const onScroll = () => { scrollT = window.scrollY * 0.0035; };
    const onMove = (e: PointerEvent) => {
      pointerT = (e.clientX / Math.max(1, window.innerWidth)) * 2.2;
      const r = canvas.getBoundingClientRect();
      const inside = e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
      if (!inside) { if (hover) armed = true; hover = false; return; } // leaving the bar re-arms it
      cx = ((e.clientX - r.left) / Math.max(1, r.width)) * cellsX;
      cy = ((e.clientY - r.top) / Math.max(1, r.height)) * CELLS_Y;
      if (!hover && lift < 0.01) { ex = cx; ey = cy; } // a fresh raise starts under the cursor
      hover = true;
    };
    // clicking a tab drops the raise until the pointer leaves the bar
    const nav = canvas.closest("nav");
    const onDown = (e: Event) => { if ((e.target as Element | null)?.closest?.("a")) armed = false; };
    const onLeave = () => { hover = false; armed = true; };
    const onResize = () => { fit(); };
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; start(); }, { threshold: 0 });
    io.observe(canvas);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    nav?.addEventListener("pointerdown", onDown, { passive: true });
    nav?.addEventListener("pointerleave", onLeave, { passive: true });
    onScroll();
    shift = scrollT; // start settled, no ease-in on load
    start();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      nav?.removeEventListener("pointerdown", onDown);
      nav?.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden="true"
      className="absolute inset-0 w-full h-full select-none pointer-events-none" />
  );
}
