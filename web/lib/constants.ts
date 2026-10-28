import { withRepeats, type PitchType } from "@/types";

// ─── Pitch Type Configuration ──────────────────────────────────────────────────

export const PITCH_CONFIG: Record<
  PitchType,
  { label: string; color: string; shortLabel: string }
> = withRepeats({
  FF: { label: "Fastball", color: "#FF4D4D", shortLabel: "FF" },
  SI: { label: "Sinker", color: "#E8761A", shortLabel: "SI" },
  CH: { label: "Changeup", color: "#3FBF5F", shortLabel: "CH" },
  CB: { label: "Curveball", color: "#3B9EFF", shortLabel: "CB" },
  SL: { label: "Slider", color: "#A56BFF", shortLabel: "SL" },
  SW: { label: "Sweeper", color: "#FF5BB0", shortLabel: "SW" },
  CT: { label: "Cutter", color: "#FFD93D", shortLabel: "CT" },
  FS: { label: "Splitter", color: "#00C7B1", shortLabel: "FS" },
  // See PITCH_COLORS in types/index.ts for why this one is grey.
  KN: { label: "Knuckleball", color: "#8B93A3", shortLabel: "KN" },
}, (c, n) => ({ ...c, label: `${c.label} ${n}`, shortLabel: `${c.shortLabel}${n}` }));

/**
 * Site pitch code -> the Stuff+/Pitching+ cell name (by_pitch / by_pitch_auto / stuff_games.json). Sweeper is its own
 * cell since v8 (a staged older reference without one falls back to Slider in tagReferenceKey / the live scorer);
 * "SL2" -> "Slider 2" is a second slider-shaped topo group, read against the Slider scale (tagReferenceKey).
 */
export const CELL_TYPE: Record<string, string> = withRepeats({
  FF: "Fastball", SI: "Sinker", CT: "Cutter", SL: "Slider", SW: "Sweeper", CB: "Curveball", CH: "ChangeUp", FS: "Splitter",
}, (n, k) => `${n} ${k}`);

/**
 * Which side of a horizontal-break axis (positive to the right) is his arm
 * side. TrackMan HB is not mirrored by hand: a RHP fastball reads +, a LHP one
 * −. So arm side is RIGHT for a righty and LEFT for a lefty; unknown hand -> null.
 */
export function armSideOf(throws: string | null | undefined): "left" | "right" | null {
  if (throws === "Right" || throws === "R") return "right";
  if (throws === "Left" || throws === "L") return "left";
  return null;
}

// ─── Leaderboard Column Definitions ────────────────────────────────────────────

export const HITTER_COLUMNS = [
  { key: "name", label: "Name", width: "180px", align: "left" as const, highlight: false },
  { key: "team", label: "Team", width: "60px", align: "left" as const, highlight: false },
  { key: "pa", label: "PA", width: "50px", align: "right" as const, highlight: false },
  { key: "woba", label: "wOBA", width: "65px", align: "right" as const, highlight: true },
  { key: "xwoba", label: "xwOBA", width: "65px", align: "right" as const, highlight: false },
  { key: "ev90", label: "EV90", width: "60px", align: "right" as const, highlight: false },
  { key: "chasePct", label: "Chase%", width: "65px", align: "right" as const, highlight: false },
  { key: "whiffPct", label: "Whiff%", width: "65px", align: "right" as const, highlight: false },
  { key: "barrelPct", label: "Barrel%", width: "70px", align: "right" as const, highlight: false },
  { key: "hardHitPct", label: "HardHit%", width: "75px", align: "right" as const, highlight: false },
  { key: "swStrPct", label: "SwStr%", width: "65px", align: "right" as const, highlight: false },
  { key: "kPct", label: "K%", width: "50px", align: "right" as const, highlight: false },
  { key: "bbPct", label: "BB%", width: "50px", align: "right" as const, highlight: false },
] as const;

export const PITCHER_COLUMNS = [
  { key: "name", label: "Name", width: "180px", align: "left" as const },
  { key: "team", label: "Team", width: "60px", align: "left" as const },
  { key: "ip", label: "IP", width: "50px", align: "right" as const },
  { key: "era", label: "RA/9", width: "55px", align: "right" as const },
  { key: "fip", label: "FIP", width: "55px", align: "right" as const },
  { key: "kPct", label: "K%", width: "50px", align: "right" as const, highlight: true },
  { key: "bbPct", label: "BB%", width: "50px", align: "right" as const },
  { key: "kBbPct", label: "K-BB%", width: "60px", align: "right" as const },
  { key: "cswPct", label: "CSW%", width: "60px", align: "right" as const },
  { key: "whiffPct", label: "Whiff%", width: "65px", align: "right" as const },
  { key: "velo", label: "Velo", width: "55px", align: "right" as const },
  { key: "ivb", label: "IVB", width: "50px", align: "right" as const },
  { key: "gbPct", label: "GB%", width: "55px", align: "right" as const },
] as const;

// ─── Pagination ────────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

// ─── Stat Formatting ───────────────────────────────────────────────────────────

/** Format a rate stat (e.g., .384 for wOBA, 28.7% for K%) */
export function formatRate(value: number | null, decimals = 1): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(decimals);
}

/** Format a percentage stat */
export function formatPct(value: number | null, decimals = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(decimals)}%`;
}

/** Format a counting stat */
export function formatCount(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toString();
}

/** Format wOBA-style stats (3 decimal places, no leading zero) */
export function formatWoba(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(3).replace(/^0/, "");
}

