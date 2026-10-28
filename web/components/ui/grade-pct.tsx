"use client";

/**
 * The percentile chip beside a season Stuff+ / ABStuff+ ("112 [84]"). The dashboard layout loads
 * stuff_percentiles.json once and wraps every page in <GradePctProvider>; which grades get a chip, and against which
 * population, is gradePct() in lib/percentiles.ts. No provider, no file, or no valid population: renders nothing.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PctChip } from "@/components/ui/shared-ui";
import { gradePct, type StuffPercentiles } from "@/lib/percentiles";

const Ctx = createContext<StuffPercentiles | null>(null);
export const useGradePcts = () => useContext(Ctx);

/**
 * D-29: which population a chip ranks in — the grade's own season (default) or
 * all seasons pooled. Persisted per browser (localStorage) and reflected in the
 * URL (?pct=pooled) so a shared link carries the scope.
 */
const ScopeCtx = createContext<{ scope: "season" | "pooled"; setScope: (s: "season" | "pooled") => void }>({
  scope: "season", setScope: () => {},
});
export const useGradeScope = () => useContext(ScopeCtx);

export function GradeScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<"season" | "pooled">("season");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("pct");
    const saved = window.localStorage.getItem("goat-pct-scope");
    if (q === "pooled" || q === "season") setScopeState(q);
    else if (saved === "pooled") setScopeState("pooled");
  }, []);
  const setScope = (s2: "season" | "pooled") => {
    setScopeState(s2);
    window.localStorage.setItem("goat-pct-scope", s2);
    const url = new URL(window.location.href);
    if (s2 === "pooled") url.searchParams.set("pct", "pooled");
    else url.searchParams.delete("pct");
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return <ScopeCtx.Provider value={{ scope, setScope }}>{children}</ScopeCtx.Provider>;
}

export function GradeScopeToggle() {
  const { scope, setScope } = useGradeScope();
  return (
    <span className="inline-flex items-center rounded-md border border-border-subtle text-[10px]" role="group" aria-label="Percentile scope">
      {(["season", "pooled"] as const).map((s2) => (
        <button key={s2} onClick={() => setScope(s2)} aria-pressed={scope === s2}
          className={`px-2 py-0.5 first:rounded-l-md last:rounded-r-md transition-colors ${
            scope === s2 ? "bg-white/[0.08] text-text-primary" : "text-text-dim hover:text-text-secondary"
          }`}
          title={s2 === "season" ? "Chips rank in the grade's own season" : "Chips rank against all seasons pooled"}>
          {s2 === "season" ? "season" : "pooled"}
        </button>
      ))}
    </span>
  );
}
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
  const { scope } = useGradeScope();
  // pooled scope: null season → gradePct falls back to the pooled population
  const r = gradePct(useGradePcts(), metric, value, n, code, scope === "pooled" ? null : season, side);
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
