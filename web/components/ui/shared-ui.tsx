/**
 * Shared display bits. `PctChip`/`luminance` were rescued from the fork's
 * defense folder (which shipped team-defense pages this MVP does not); `Signed`
 * and `signedFixed` likewise from its signed-stat helper.
 */
import type { ReactNode } from "react";
import { percentileColor } from "@/lib/percentiles";

/** Relative luminance of a hex colour, 0–1. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** A percentile as a filled chip (colour = the site ramp, dark or light text for contrast). `children` overrides the label. */
export function PctChip({ p, title, children }: { p: number; title?: string; children?: ReactNode }) {
  const bg = percentileColor(p);
  return (
    <span data-pct={Math.round(p)} title={title ?? `${Math.round(p)}th percentile`}
      className="inline-flex min-w-[1.9rem] justify-center rounded-md px-1 py-[1px] font-data text-[10px] font-semibold leading-4 tabular-nums"
      style={{ backgroundColor: bg, color: luminance(bg) > 0.4 ? "#10141b" : "#ffffff" }}>
      {children ?? Math.round(p)}
    </span>
  );
}

export const GOOD = percentileColor(95), BAD = percentileColor(5);

/** A signed stat, coloured by what it means for the player: green when good for him, red when bad, nothing at zero. */
export function toneColor(v: number | null | undefined, lowerIsGood = false, dp = 2): string | undefined {
  if (v == null || !Number.isFinite(v) || Number(v.toFixed(dp)) === 0) return undefined;
  return (v > 0) !== lowerIsGood ? GOOD : BAD;
}

/** "+1.2" / "−0.5"; a value that ROUNDS to zero prints "0.0" with no sign (−0.0 reads as "slightly bad"). */
export function signedFixed(x: number | null | undefined, dp: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const r = Number(x.toFixed(dp));
  if (r === 0) return (0).toFixed(dp);
  return (r > 0 ? "+" : "−") + Math.abs(r).toFixed(dp);
}

export function Signed({ v, dp, lowerIsGood = false, className = "font-data" }: { v: number | null | undefined; dp: number; lowerIsGood?: boolean; className?: string }) {
  return <span className={className} style={{ color: toneColor(v, lowerIsGood, dp) }}>{signedFixed(v, dp)}</span>;
}
