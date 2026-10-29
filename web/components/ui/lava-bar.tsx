"use client";

/**
 * The lava header: ONE field, two windows. A thin full-width band runs along
 * the top edge of the navigation, and the ACTIVE pill renders the segment of
 * the very same stream at its horizontal position — both sample a shared
 * field function off the same clock, so the pill is literally part of the
 * flow, not a separate decoration. Cells are small, flat and blocky (2 rows
 * on the band, 3 in the pill), stretched with image-rendering: pixelated;
 * the palette is the site's pastel sweep, dropped darker, with sparse deep
 * flashes. Phase follows scroll + pointer so the stream slides when you move;
 * reduced motion renders one static frame.
 */

import { useEffect, useRef } from "react";

// the shared field — same function, same clock, same horizontal mapping
const CELLS_X = 160;               // band cells across the viewport width
const HUE_BASE = 178;
const HUE_SPAN = 118;
const SAT: [number, number] = [48, 62];
const LIG: [number, number] = [40, 58];   // darker than the first version
const DEEP_LIG = 30;
const DEEP_EVERY = 11;             // sparse deep flashes

function cellColor(x: number, y: number, ySpan: number, time: number, shift: number, frame: number): string {
  const wave = Math.sin(x * 0.19 + time * 0.21 + shift)
    + Math.sin(x * 0.07 - time * 0.13 - shift * 1.4 + Math.sin(time * 0.07) * 2)
    + Math.sin((x + y * 18) * 0.11 + time * 0.09 + shift * 0.6);
  let lig = LIG[0] + (LIG[1] - LIG[0]) * (0.5 + 0.5 * Math.sin(y * 1.7 + time * 0.11 + x * 0.05));
  if ((x * 7 + y * 13 + frame) % (DEEP_EVERY * CELLS_X) === 0) lig = DEEP_LIG;
  const hue = HUE_BASE + wave * HUE_SPAN * 0.5 + (y / Math.max(1, ySpan - 1)) * 10;
  const sat = SAT[0] + (SAT[1] - SAT[0]) * (0.5 + 0.5 * Math.sin(x * 0.3 + time * 0.05));
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${lig.toFixed(0)}%)`;
}

function sharedShift(): number {
  return (typeof window !== "undefined" ? window.scrollY : 0) * 0.0035;
}

/** The full-width band at the top edge of the navigation. */
export function LavaBar({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const Y = 2; // flat: two cell rows
    canvas.width = CELLS_X;
    canvas.height = Y;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = 0, frame = 0;
    const draw = (t: number) => {
      frame++;
      const time = t / 1000;
      const shift = sharedShift() + pointerShift();
      for (let y = 0; y < Y; y++) {
        for (let x = 0; x < CELLS_X; x++) {
          ctx.fillStyle = cellColor(x, y, Y, time, shift, frame);
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };
    const loop = (t: number) => {
      if (t - last >= 130) { last = t; draw(t); }
      raf = requestAnimationFrame(loop);
    };
    if (reduced) draw(0);
    else raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas ref={ref} aria-hidden="true"
      className={`block w-full h-[8px] [image-rendering:pixelated] select-none ${className}`} />
  );
}

let pointerShift = () => 0;
if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => {
    pointerShift = () => (e.clientX / Math.max(1, window.innerWidth)) * 0.0022 * 1000;
  }, { passive: true });
}

/**
 * The ACTIVE pill: the same stream, sampled at the pill's horizontal
 * position — its cells line up with the band's, so the header reads as one
 * field the pill is part of.
 */
export function LavaPill() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const Y = 3;
    canvas.width = 26;
    canvas.height = Y;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = 0, frame = 0;
    let x0 = 0;
    const align = () => {
      const r = canvas.getBoundingClientRect();
      x0 = Math.round((r.left + r.width / 2) / Math.max(1, window.innerWidth) * CELLS_X) - canvas.width / 2;
    };
    align();
    window.addEventListener("resize", align);
    const draw = (t: number) => {
      frame++;
      const time = t / 1000;
      const shift = sharedShift() + pointerShift();
      for (let y = 0; y < Y; y++) {
        for (let i = 0; i < canvas.width; i++) {
          ctx.fillStyle = cellColor(x0 + i, y + 3, Y, time, shift, frame); // y+3: the band's rows run on
          ctx.fillRect(i, y, 1, 1);
        }
      }
    };
    const loop = (t: number) => {
      if (t - last >= 130) { last = t; frame % 20 === 0 && align(); draw(t); }
      raf = requestAnimationFrame(loop);
    };
    if (reduced) draw(0);
    else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", align); };
  }, []);
  return (
    <canvas ref={ref} aria-hidden="true"
      className="absolute inset-0 w-full h-full rounded-full [image-rendering:pixelated] opacity-90" />
  );
}
