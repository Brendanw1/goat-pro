/**
 * /pitchers board: columns, defaults, the filter+search+sort, and the
 * league-median row machinery. MVP surface per docs/parity-matrix.md: identity
 * + raw rates (P1–P3) + the frozen grades (P5, P6). NEEDS-MODEL columns (Loc+,
 * xRV, xwOBA, park) and the discipline-shrinkage group (P4) are deleted, not
 * stubbed — a column here is a column the producer bakes.
 */
import { applyFilters, type FilterColumn } from "@/lib/column-filters";
import { sortComparator } from "@/lib/table-sort";
import { distinct, filterMeta, pageOf, project, rowKeys, type BoardPage, type BoardState, type FilterMeta, playedFor } from "./shared";
import { PITCHING_TIP, STUFF_TIP, K_TIP, PREVENTION_TIP, CONTROL_TIP } from "@/lib/grades";
import { RV100_TIP } from "@/lib/rv-cells";

export const TRAD_COLUMNS = [
  { key: "name", label: "Name", w: "flex-[2.5] min-w-[150px]", align: "left" },
  { key: "team", label: "Team", w: "w-[56px]", align: "left" },
  { key: "season", label: "Yr", w: "w-[44px]", align: "right" },
  { key: "role", label: "Role", w: "w-[40px]", align: "left" },
  { key: "age", label: "Age", w: "w-[40px]", align: "right" },
  { key: "ip", label: "IP", w: "w-[40px]", align: "right" },
  { key: "fip", label: "FIP", w: "w-[44px]", align: "right" },
  { key: "era", label: "RA/9", w: "w-[44px]", align: "right" },
  { key: "kPct", label: "K%", w: "w-[40px]", align: "right" },
  { key: "bbPct", label: "BB%", w: "w-[40px]", align: "right" },
  { key: "kBbPct", label: "K-BB%", w: "w-[48px]", align: "right" },
  { key: "cswPct", label: "CSW%", w: "w-[48px]", align: "right" },
  { key: "whiffPct", label: "Whiff%", w: "w-[52px]", align: "right" },
  { key: "velo", label: "Velo", w: "w-[44px]", align: "right" },
  { key: "ivb", label: "IVB", w: "w-[40px]", align: "right" },
  { key: "gbPct", label: "GB%", w: "w-[44px]", align: "right" },
] as const;

export const MODEL_COLUMNS = [
  { key: "war", label: "WAR", w: "w-[52px]", align: "right", tip: "Wins above replacement, the site's own (RESULTS-MLB §85): FIP-based like FanGraphs: park-adjusted FIP against the league run environment, replacement set by role, relievers credited for the leverage they pitch in. Matches Baseball-Reference WAR at r .81 (theirs is runs-allowed based). Glossary: WAR." },
  { key: "stuffPlus", label: "Whiff+", w: "w-[76px]", align: "right", tip: STUFF_TIP },
  { key: "kPlus", label: "K+", w: "w-[56px]", align: "right", tip: K_TIP },
  { key: "preventionPlus", label: "Prevention+", w: "w-[96px]", align: "right", tip: PREVENTION_TIP },
  { key: "controlPlus", label: "Control+", w: "w-[80px]", align: "right", tip: CONTROL_TIP },
  { key: "deceptionPlus", label: "Deception+", w: "w-[88px]", align: "right", tip: "How much slower and later batters swing against him than against everyone else (bat speed and contact point vs each batter's own norm), 100 = average, 10 = one SD. Bat tracking, 2023 on; 200+ tracked swings. Descriptive (passed its stability gates)." },
  { key: "pitchingPlus", label: "Pitching+", w: "w-[84px]", align: "right", tip: PITCHING_TIP },
  // The previous Stuff+ model on one scale across all pitch types.
  // Measured (P10), on this board because the reader who sorts models by
  // results is exactly who this column serves; medians ride the league row.
  { key: "rvPer100", label: "RV/100", w: "w-[54px]", align: "right", tip: RV100_TIP },
] as const;

/** Columns with a pinned league-median row, recomputed over the filtered rows server-side. */
export const LEAGUE_ROW_KEYS = new Set<string>(["rvPer100"]);

/**
 * The plate-discipline group (P4), RAW rates only. The college EB shrinkage
 * constants (lib/discipline.ts halfSignal) do not carry to MLB and the
 * re-measure has not run — so no shrunk twins ship yet: these are plain rates
 * with descriptive per-season percentile ranks, and the tooltip says so.
 */
export const DISCIPLINE_COLUMNS = [
  { key: "zonePct", label: "Zone%", w: "w-[50px]", align: "right", tip: "Pitches in the zone. Assigned by the pitcher — ranked, no good/bad direction." },
  { key: "chasePct", label: "Chase%", w: "w-[54px]", align: "right", tip: "Out-of-zone swings over out-of-zone pitches. Higher = more chases induced." },
  { key: "zSwingPct", label: "Z-Swg%", w: "w-[54px]", align: "right", tip: "In-zone swings over in-zone pitches. Ranked, no good/bad direction." },
  { key: "zWhiffPct", label: "Z-Whf%", w: "w-[54px]", align: "right", tip: "Whiffs on in-zone swings." },
  { key: "oWhiffPct", label: "O-Whf%", w: "w-[54px]", align: "right", tip: "Whiffs on out-of-zone swings." },
  { key: "zContactPct", label: "Z-Con%", w: "w-[54px]", align: "right", tip: "In-zone swings that put the ball in play. Lower = more missed bats in the zone.", asc: true },
  { key: "oContactPct", label: "O-Con%", w: "w-[54px]", align: "right", tip: "Out-of-zone swings that put the ball in play. Lower = better.", asc: true },
  { key: "swStrPct", label: "SwStr%", w: "w-[54px]", align: "right", tip: "Called plus swinging strikes over total pitches." },
  { key: "calledStrikePct", label: "CS%", w: "w-[46px]", align: "right", tip: "Called strikes over taken pitches." },
  { key: "firstPitchStrikePct", label: "F-Str%", w: "w-[54px]", align: "right", tip: "First-pitch strikes over first pitches." },
  { key: "putawayPct", label: "PutAwy%", w: "w-[58px]", align: "right", tip: "CSW rate with two strikes." },
] as const;

/** Denominators the discipline tooltips stand on — shipped with every row. */
export const DISCIPLINE_DEN_KEYS = ["nOozPitches", "nZonePitches", "nZoneSwings", "nFirstPitch", "nTwoStrike", "nSwings", "nPitchesLoc"] as const;

/** The sample-adjusted twins (baked: shrunk toward the season's league rate with the measured half-signal k). */
export const DISCIPLINE_SHRUNK_KEYS = DISCIPLINE_COLUMNS.map((c) => `${c.key}Shrunk` as const);

/** Sorting a discipline column ranks the SHRUNK twin (the printed number stays raw); null when a row has no twin. */
export const shrunkSortKey = (key: string): string | null =>
  (DISCIPLINE_SHRUNK_KEYS as readonly string[]).includes(`${key}Shrunk`) ? `${key}Shrunk` : null;

export const PITCHER_FILTER_DEFAULTS = { team: "", minIP: 0, throws: "", role: "", season: "", minVelo: 0, minKPct: 0, minStuff: 0, minPitching: 0 };

export const PITCHER_DEFAULTS: BoardState = {
  search: "", filters: PITCHER_FILTER_DEFAULTS, colFilters: [], sortBy: "stuffPlus", sortDir: "desc", page: 1,
};

/** Every displayed column, filterable from "+ Add filter" (lib/column-filters.ts), grouped as the board groups them. */
export const PITCHER_FILTER_COLUMNS: FilterColumn[] = [
  ...TRAD_COLUMNS.filter((c) => c.key !== "name").map((c) => ({ key: c.key, label: c.label, group: "Results" })),
  ...MODEL_COLUMNS.filter((c) => c.key !== "rvPer100").map((c) => ({ key: c.key, label: c.label, group: "Models (descriptive)" })),
  { key: "rvPer100", label: "RV/100", group: "Run value (measured)" },
  ...DISCIPLINE_COLUMNS.map((c) => ({ key: c.key, label: c.label, group: "Discipline (raw rates)" })),
  { key: "confidence", label: "Grade confidence", group: "Context" },
];
/** Every stat with a percentile on the pitcher profile is filterable too (owner ask), column or not. */
const PITCHER_PROFILE_FILTERS: [string, [string, string][]][] = [
  ["Contact allowed", [["xwobaAg", "xwOBA"], ["xbaAg", "xBA"], ["xslgAg", "xSLG"], ["xwobaconAg", "xwOBACON"], ["evAg", "Avg EV"],
    ["hardHitPctAg", "Hard-hit%"], ["barrelPctAg", "Barrel%"], ["sweetSpotPctAg", "Sweet-spot%"]]],
  ["Swings against (bat tracking)", [["batSpeedAg", "Bat speed"], ["squaredUpPctAg", "Squared-up%"], ["blastPctAg", "Blast%"]]],
  ["Run value", [["rvPer100Fb", "RV/100 fastballs"], ["rvPer100Br", "RV/100 breaking"], ["rvPer100Os", "RV/100 offspeed"],
    ["xrvPer100", "xRV/100"], ["rvLuck", "RV − xRV"], ["pitchingRunsPer100", "Runs+/100"]]],
  ["Profile", [["kPct", "K%"], ["bbPct", "BB%"], ["kProj", "K proj"], ["tunnelPlus", "Tunnel+"]]],
];
for (const [group, cols] of PITCHER_PROFILE_FILTERS)
  for (const [key, label] of cols)
    if (!PITCHER_FILTER_COLUMNS.some((c) => c.key === key)) PITCHER_FILTER_COLUMNS.push({ key, label, group });

export const PITCHER_SORT_KEYS = [...TRAD_COLUMNS, ...MODEL_COLUMNS, ...DISCIPLINE_COLUMNS].map((c) => c.key as string);

/** What the table's cells, tooltips and links read (plus the confidence badge) — the route sends nothing else. */
export const PITCHER_ROW_KEYS = rowKeys("pitcher", PITCHER_SORT_KEYS, [
  "confidence", "nPitches", ...DISCIPLINE_DEN_KEYS, ...DISCIPLINE_SHRUNK_KEYS,
]);

export interface PitchersMeta { teams: string[]; seasons: number[]; filters: FilterMeta }

export function pitchersMeta(data: PitcherRowAny[]): PitchersMeta {
  return {
    teams: [...new Set(data.map((r) => r.team))].sort(),
    seasons: [...new Set(data.map((r) => r.season))].sort((a: number, b: number) => b - a),
    filters: filterMeta(data, PITCHER_FILTER_COLUMNS),
  };
}

type PitcherRowAny = Record<string, any>;

export function filterPitchers(data: PitcherRowAny[], s: BoardState): PitcherRowAny[] {
  const { search, filters, colFilters, sortBy, sortDir } = s as BoardState & { filters: Record<string, any> };
  // A copy: on the server `data` is shared across requests, and it is sorted below.
  let rows = [...data];
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q),
    );
  }
  if (filters.team) rows = rows.filter((r) => playedFor(r, filters.team));
  if (filters.season) rows = rows.filter((r) => String(r.season) === String(filters.season));
  if (filters.minIP > 0) rows = rows.filter((r) => r.ip >= filters.minIP);
  if (filters.throws) rows = rows.filter((r) => r.throws === filters.throws);
  if (filters.role) rows = rows.filter((r) => r.role === filters.role); // SP: GS >= half of G (official lines)
  if (filters.minVelo > 0) rows = rows.filter((r) => (r.velo || 0) >= filters.minVelo);
  if (filters.minKPct > 0) rows = rows.filter((r) => (r.kPct || 0) >= filters.minKPct);
  if (filters.minStuff > 0) rows = rows.filter((r) => (r.stuffPlus || 0) >= filters.minStuff);
  if (filters.minPitching > 0) rows = rows.filter((r) => (r.pitchingPlus || 0) >= filters.minPitching);
  rows = applyFilters(rows, colFilters, PITCHER_FILTER_COLUMNS);

  // One comparator for every board -- lib/table-sort.ts. A discipline column
  // sorts by its sample-adjusted twin: the printed rate stays raw, the ORDER
  // stops rewarding a 2-event 0.0. Blanks (no twin) sink via table-sort.
  const sk = shrunkSortKey(sortBy);
  rows.sort(sortComparator(sk ?? sortBy, sortDir));
  return rows;
}

export type PitchersPage = BoardPage<PitcherRowAny> & { medians: Record<string, number | null> };

/**
 * One page projected to PITCHER_ROW_KEYS, plus the league-median row.
 *
 * The medians are recomputed from every row matching the filters, after every
 * filter and before pagination. The MVP column set carries no run-value column,
 * so the median row is empty; the machinery stays because RV/100 (P10,
 * derivable) lands in wave 2 and the row is where its marker lives.
 */
export function queryPitchers(data: PitcherRowAny[], s: BoardState): PitchersPage {
  const filtered = filterPitchers(data, s);
  const medians: Record<string, number | null> = {};
  for (const key of LEAGUE_ROW_KEYS) {
    const v = filtered
      .map((r) => r[key])
      .filter((x: unknown): x is number => typeof x === "number" && Number.isFinite(x))
      .sort((a: number, b: number) => a - b);
    medians[key] = v.length ? (v.length % 2 ? v[v.length >> 1] : (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2) : null;
  }
  const p = pageOf(filtered, s.page);
  return { ...p, rows: project(p.rows, PITCHER_ROW_KEYS), medians };
}

/** Server-page props: meta and the default first page, never the full array. */
export const pitchersProps = (data: PitcherRowAny[]) => ({ meta: pitchersMeta(data), initial: queryPitchers(data, PITCHER_DEFAULTS) });
