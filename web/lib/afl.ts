import { armSideHb } from "@/lib/arm-slot";

/**
 * Arizona Fall League page helpers (pipeline/afl_export.py bakes afl/{index,<season>}.json).
 * Pure functions only, so the page and its test share them.
 */

/** Sample tier from pitches thrown or seen: the site's pitch-count floors (glossary "Confidence"). */
export function sampleTier(pitches: number | null | undefined): "HIGH" | "MODERATE" | "LOW" | "MINIMAL" {
  const n = pitches ?? 0;
  return n >= 400 ? "HIGH" : n >= 150 ? "MODERATE" : n >= 50 ? "LOW" : "MINIMAL";
}

/** The existing profile for a player: MLB Statcast page, else his minor-league page, else none. */
export function profileHref(r: { id: string; page?: string | null }, season?: number): string | null {
  if (r.page === "mlb") return `/player/${r.id}`;
  if (r.page === "minors") return `/minors/player/${r.id}${season ? `?season=${season}` : ""}`;
  return null;
}

export type AflType = { type: string; n: number; dVelo?: number | null; dIvb?: number | null; dHb?: number | null; dUsage?: number | null };

/**
 * One line per changed pitch type for the "AFL vs regular season" view: velocity, usage and movement, each
 * only when the change clears a display threshold (0.5 mph, 5 points of usage, 1.5 inches), so a few weeks'
 * wobble stays off the table. HB is arm-side: + more run, − more sweep.
 */
export function typeChanges(types: AflType[] | null | undefined, throws: string | null | undefined): string[] {
  const f = (v: number, dp: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}`;
  const out: string[] = [];
  for (const t of types ?? []) {
    const bits: string[] = [];
    if (t.dVelo != null && Math.abs(t.dVelo) >= 0.5) bits.push(`${f(t.dVelo, 1)} mph`);
    if (t.dUsage != null && Math.abs(t.dUsage) >= 5) bits.push(`${f(t.dUsage, 0)}% use`);
    if (t.dIvb != null && Math.abs(t.dIvb) >= 1.5) bits.push(`${f(t.dIvb, 1)}" IVB`);
    const hb = armSideHb(t.dHb, throws); // the site's one HB convention (Statcast pfx_x is the catcher's view)
    if (hb != null && Math.abs(hb) >= 1.5) bits.push(`${f(hb, 1)}" arm-side HB`);
    if (bits.length) out.push(`${t.type} ${bits.join(", ")}`);
  }
  return out;
}
