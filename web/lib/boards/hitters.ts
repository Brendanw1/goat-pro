/**
 * /hitters board: columns, defaults, the filter+search+sort. MVP surface per
 * docs/parity-matrix.md: H1 identity/slash, H3 batted-ball quality, H4
 * discipline — all measured, all DERIVABLE-NOW. NEEDS-MODEL columns (xwOBA,
 * decision grades, park factors) are deleted, not stubbed. wOBA weights are
 * derived from this mart (see the glossary), so wOBA is descriptive like
 * everything else here.
 */
import { applyFilters, type FilterColumn } from "@/lib/column-filters";
import { sortComparator } from "@/lib/table-sort";
import { distinct, filterMeta, pageOf, project, rowKeys, type BoardPage, type BoardState, type FilterMeta, playedFor } from "./shared";

export const HITTER_RESULT_COLUMNS = [
  { key: "name", label: "Name", w: "flex-[2.5] min-w-[150px]", align: "left" },
  { key: "team", label: "Team", w: "w-[56px]", align: "left" },
  { key: "season", label: "Yr", w: "w-[44px]", align: "right" },
  { key: "age", label: "Age", w: "w-[40px]", align: "right" },
  { key: "pa", label: "PA", w: "w-[44px]", align: "right" },
  { key: "avg", label: "AVG", w: "w-[48px]", align: "right" },
  { key: "obp", label: "OBP", w: "w-[48px]", align: "right" },
  { key: "slg", label: "SLG", w: "w-[48px]", align: "right" },
  { key: "ops", label: "OPS", w: "w-[52px]", align: "right" },
  { key: "iso", label: "ISO", w: "w-[48px]", align: "right" },
  { key: "kPct", label: "K%", w: "w-[44px]", align: "right" },
  { key: "bbPct", label: "BB%", w: "w-[48px]", align: "right" },
] as const;

export const HITTER_QUALITY_COLUMNS = [
  { key: "woba", label: "wOBA", w: "w-[54px]", align: "right", tip: "wOBA on linear weights derived from this site's own run-expectancy data, league average centred at .310 — descriptive, like everything on this site." },
  { key: "ev90", label: "EV90", w: "w-[48px]", align: "right", tip: "90th percentile exit velocity of his balls in play — the hard contact he carries, not the lucky one." },
  { key: "maxEv", label: "MaxEV", w: "w-[52px]", align: "right", tip: "Hardest ball in play this season." },
  { key: "hardHitPct", label: "HH%", w: "w-[48px]", align: "right", tip: "Balls in play at 95 mph or harder." },
  { key: "xwoba", label: "xwOBA", w: "w-[54px]", align: "right", tip: "Statcast expected wOBA: each ball in play valued by its exit velocity and launch angle (plus sprint speed on weak grounders), walks and strikeouts at face value." },
  { key: "batSpeed", label: "BatSpd", w: "w-[54px]", align: "right", tip: "Average bat speed (mph) of his fastest 90% of tracked swings; 50+ tracked swings, 2024 on." },
  { key: "squaredUpPct", label: "SqUp%", w: "w-[52px]", align: "right", tip: "Balls in play hit at 80%+ of the exit velocity his bat speed and the pitch's speed at the plate allow, per competitive swing." },
  { key: "sprintSpeed", label: "Sprint", w: "w-[50px]", align: "right", tip: "Savant sprint speed: feet per second in his fastest one-second window." },
  { key: "barrelPct", label: "Brl%", w: "w-[48px]", align: "right", tip: "Statcast barrels (exit velocity + launch angle combos) over balls in play." },
  { key: "whiffPct", label: "Whiff%", w: "w-[54px]", align: "right", tip: "Whiffs over swings — lower is better for a hitter.", asc: true },
  { key: "oSwingPct", label: "O-Swg%", w: "w-[54px]", align: "right", tip: "Swings at pitches out of the zone — chasing; lower is better.", asc: true },
] as const;

/** The site's models and value columns (Decision+ from the decision model; range runs and Framing+ joined from
 * their own families in getHitters; Savant's fielding and baserunning run values, labelled theirs). */
export const HITTER_MODEL_COLUMNS = [
  { key: "decisionPlus", label: "Decision+", w: "w-[76px]", align: "right", tip: "Swing decisions: run value of his swing/take choices vs an average hitter given each pitch's location and count. 100 = average, 10 = one SD (hitters with 100+ PA)." },
  { key: "rangeRuns", label: "Range", w: "w-[58px]", align: "right", tip: "Site range model: runs saved vs an average fielder at the position on the balls he had a chance at (all positions summed; 30+ chances). See the Defense board." },
  { key: "framingPlus", label: "Framing+", w: "w-[70px]", align: "right", tip: "Catchers: strikes stolen above a called-strike model, 100 = average, 10 = one SD (2,500+ taken pitches)." },
  { key: "frvRuns", label: "Sav FRV", w: "w-[62px]", align: "right", tip: "Savant's fielding run value (their number, shown for reference)." },
  { key: "bsrRuns", label: "Sav BsR", w: "w-[62px]", align: "right", tip: "Savant's baserunning run value (their number, shown for reference)." },
] as const;

export const HITTER_DEFAULTS: BoardState = {
  search: "", filters: { team: "", season: "", bats: "", minPA: 100, minEv90: 0 }, colFilters: [],
  sortBy: "woba", sortDir: "desc", page: 1,
};

export const HITTER_FILTER_COLUMNS: FilterColumn[] = [
  ...HITTER_RESULT_COLUMNS.filter((c) => c.key !== "name").map((c) => ({ key: c.key, label: c.label, group: "Results" })),
  ...HITTER_QUALITY_COLUMNS.map((c) => ({ key: c.key, label: c.label, group: "Contact quality" })),
  ...HITTER_MODEL_COLUMNS.map((c) => ({ key: c.key, label: c.label, group: "Models & value" })),
  { key: "bats", label: "Bats", group: "Context" },
];

export const HITTER_SORT_KEYS = [...HITTER_RESULT_COLUMNS, ...HITTER_QUALITY_COLUMNS, ...HITTER_MODEL_COLUMNS].map((c) => c.key as string);
export const HITTER_ROW_KEYS = rowKeys("hitter", HITTER_SORT_KEYS, [
  "whiffPctShrunk", "oSwingPctShrunk", "rangePos",
]);

export interface HittersMeta { teams: string[]; seasons: number[]; filters: FilterMeta }

export function hittersMeta(data: Record<string, any>[]): HittersMeta {
  return {
    teams: [...new Set(data.map((r) => r.team))].filter(Boolean).sort(),
    seasons: [...new Set(data.map((r) => r.season))].sort((a: number, b: number) => b - a),
    filters: filterMeta(data, HITTER_FILTER_COLUMNS),
  };
}

/** Discipline columns sort by their sample-adjusted twin (printed rate stays raw). */
export const shrunkSortKey = (key: string): string | null =>
  ["whiffPct", "oSwingPct"].includes(key) ? `${key}Shrunk` : null;

export function filterHitters(data: Record<string, any>[], s: BoardState): Record<string, any>[] {
  const { search, filters, colFilters, sortBy, sortDir } = s as BoardState & { filters: Record<string, any> };
  let rows = [...data];
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => r.name?.toLowerCase().includes(q) || r.team?.toLowerCase().includes(q));
  }
  if (filters.team) rows = rows.filter((r) => playedFor(r, filters.team));
  if (filters.season) rows = rows.filter((r) => String(r.season) === String(filters.season));
  if (filters.bats) rows = rows.filter((r) => r.bats === filters.bats);
  if (filters.minPA > 0) rows = rows.filter((r) => (r.pa || 0) >= filters.minPA);
  if (filters.minEv90 > 0) rows = rows.filter((r) => (r.ev90 || 0) >= filters.minEv90);
  rows = applyFilters(rows, colFilters, HITTER_FILTER_COLUMNS);
  rows.sort(sortComparator(shrunkSortKey(sortBy) ?? sortBy, sortDir));
  return rows;
}

export type HittersPage = BoardPage<Record<string, any>>;

export function queryHitters(data: Record<string, any>[], s: BoardState): HittersPage {
  const filtered = filterHitters(data, s);
  const p = pageOf(filtered, s.page);
  return { ...p, rows: project(p.rows, HITTER_ROW_KEYS) };
}

export const hittersProps = (data: Record<string, any>[]) => ({ meta: hittersMeta(data), initial: queryHitters(data, HITTER_DEFAULTS) });
