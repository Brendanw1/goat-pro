"use client";

/**
 * The percentile chip beside a season Stuff+ / ABStuff+ ("112 [84]"). The dashboard layout loads
 * stuff_percentiles.json once and wraps every page in <GradePctProvider>; which grades get a chip, and against which
 * population, is gradePct() in lib/percentiles.ts. No provider, no file, or no valid population: renders nothing.
 */
import { createContext, useContext, type ReactNode } from "react";
import { PctChip } from "@/components/ui/shared-ui";
import { gradePct, type StuffPercentiles } from "@/lib/percentiles";

const Ctx = createContext<StuffPercentiles | null>(null);
export const useGradePcts = () => useContext(Ctx);
export function GradePctProvider({ data, children }: { data: StuffPercentiles | null; children: ReactNode }) {
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function GradePct({ metric, value, n, code, season, side, className = "ml-1" }: {
  metric: string; value: number | null | undefined; n: number | null | undefined; code?: string | null;
  /** rank inside this season's own population */
  season?: string | number | null;
  /** batter side of a split grade; n is then the pitches vs that side */
  side?: "L" | "R"; className?: string;
}) {
  const r = gradePct(useGradePcts(), metric, value, n, code, season, side);
  if (!r) return null;
  // The rank is printed (not colour alone); hover names the population, and screen readers hear the same sentence.
  return (
    <span className={`inline-flex align-middle ${className}`}>
      <span aria-hidden><PctChip p={r.p} title={r.title} /></span>
      <span className="sr-only">, {r.title}</span>
    </span>
  );
}

/** Pitches a season row's grade rests on, under whichever name its file uses; null when the row does not say. */
export const gradedN = (r: any): number | null => {
  const n = r?.nStuffPitches ?? r?.nPitches ?? r?.n_pitches ?? r?.n;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Hover note and muted style for a season pitch-type Stuff+ / Pitch+ cell. Cells under the model's 10-pitch floor are
 * graded since 2026-10-21 (stuffSmall = 1): shown muted, n and band in the tooltip, never a percentile.
 */
export function stuffCellNote(r: any, code?: string | null): { title?: string; muted: boolean } {
  if (code === "KN") return { title: "No model: knuckleballs are not graded by Whiff+ or Pitching+", muted: true };
  if (typeof r?.stuffPlus !== "number") return { title: "Not graded: none of these pitches could be scored (movement or spin not tracked), or the pitcher has no season grade", muted: true };
  if (r?.stuffSmall !== 1) return { muted: false };
  const n = gradedN(r);
  const ci = typeof r.stuffPlusCI_lo === "number" && typeof r.stuffPlusCI_hi === "number" ? `, 95% CI ${r.stuffPlusCI_lo}-${r.stuffPlusCI_hi}` : "";
  return { title: `Small sample: ${n ?? "few"} graded pitches${ci}. Under the 10-pitch cell floor, so read it loosely; no percentile.`, muted: true };
}
