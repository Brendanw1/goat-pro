/**
 * /arsenal/[pitch] board: columns, defaults and the filter+sort for one pitch
 * type. MVP surface per docs/parity-matrix.md: raw rows (A6) + stuff grades
 * (A7). The NEEDS-MODEL columns (Loc+, xRV+, contact-suppression z) are
 * deleted, not stubbed.
 */
import { applyFilters, type FilterColumn } from "@/lib/column-filters";
import { compareValues } from "@/lib/table-sort";
import { filterMeta, pageOf, project, rowKeys, type BoardPage, type BoardState, type FilterMeta } from "./shared";
import { RV100_TIP } from "@/lib/rv-cells";
import { SLOT_BANDS } from "@/lib/arm-slot";
import { AGE_TIP, DECEPTION_COL_TIP, DIVB_SLOT_TIP, DHB_SLOT_TIP } from "./slot";

export const PREV_PITCH_TIP = "Prevention+ (pitch): how many runs this pitch should save next season, judged from how it misses bats, gets chases and called strikes, avoids hard contact, and plays off the fastball. 100 = average, 10 = one SD. A forecast, tested on held-out pitchers (RESULTS-MLB §101). MLB only, 150+ pitches of the type.";

export const COLS = [
  { key: "name", label: "Name", w: "flex-[2] min-w-[150px]", align: "left" },
  { key: "team", label: "Team", w: "w-[60px]", align: "left" },
  { key: "season", label: "Yr", w: "w-[44px]", align: "right" },
  { key: "age", label: "Age", w: "w-[40px]", align: "right", tip: AGE_TIP },
  { key: "n_pitches", label: "N", w: "w-[44px]", align: "right" },
  { key: "usage", label: "Usage", w: "w-[52px]", align: "right" },
  { key: "velo", label: "Velo", w: "w-[48px]", align: "right" },
  { key: "ivb", label: "IVB", w: "w-[44px]", align: "right" },
  { key: "hb", label: "HB", w: "w-[44px]", align: "right" },
  { key: "dIvbSlot", label: "ΔIVB slot", w: "w-[60px]", align: "right", tip: DIVB_SLOT_TIP },
  { key: "dHbSlot", label: "ΔHB slot", w: "w-[60px]", align: "right", tip: DHB_SLOT_TIP },
  { key: "spin", label: "Spin", w: "w-[48px]", align: "right" },
  { key: "vaa", label: "VAA", w: "w-[44px]", align: "right" },
  { key: "ext", label: "Ext", w: "w-[44px]", align: "right" },
  { key: "zonePct", label: "Zone%", w: "w-[52px]", align: "right" },
  { key: "whiffPct", label: "Whiff%", w: "w-[56px]", align: "right", highlight: true },
  { key: "cswPct", label: "CSW%", w: "w-[52px]", align: "right" },
  { key: "rv100", label: "RV/100", w: "w-[54px]", align: "right", tip: RV100_TIP },
  { key: "stuffPlus", label: "Whiff+", w: "w-[112px]", align: "right", model: true },
  { key: "pitchingPlus", label: "Pitching+", w: "w-[84px]", align: "right", model: true },
  { key: "prevPitch", label: "Prev+", w: "w-[64px]", align: "right", model: true, tip: PREV_PITCH_TIP },
  { key: "deceptionPlus", label: "Deception+", w: "w-[80px]", align: "right", tip: DECEPTION_COL_TIP },
] as const;

export const ARSENAL_FILTER_DEFAULTS = { team: "", season: "", band: "", minPitches: 0, minUsage: 0, minVelo: 0 };

export const ARSENAL_DEFAULTS: BoardState = {
  search: "", filters: ARSENAL_FILTER_DEFAULTS, colFilters: [], sortBy: "stuffPlus", sortDir: "desc", page: 1,
};

/** Every displayed column, filterable from "+ Add filter" (lib/column-filters.ts). */
export const ARSENAL_FILTER_COLUMNS: FilterColumn[] = [
  ...COLS.filter((c) => c.key !== "name").map((c) => ({ key: c.key, label: c.label, group: ("model" in c && c.model) || c.key === "deceptionPlus" ? "Models (descriptive)" : "Shape & results" })),
];

export const ARSENAL_SORT_KEYS = COLS.map((c) => c.key as string);

/** What the cells and the name badges (confidence) read — the route sends nothing else. */
export const ARSENAL_ROW_KEYS = rowKeys("pitcher", ARSENAL_SORT_KEYS, ["confidence", "stuffGradeFrom", "nStuffPitches", "gyro", "band", "ivbSlotPeer", "hbSlotPeer", "hbArm"]);

export interface ArsenalMeta { teams: string[]; seasons: number[]; filters: FilterMeta }

export function arsenalMeta(data: any[]): ArsenalMeta {
  return {
    teams: [...new Set(data.map((r) => r.team))].sort(),
    seasons: [...new Set(data.map((r) => r.season))].sort((a: number, b: number) => b - a),
    filters: filterMeta(data, ARSENAL_FILTER_COLUMNS),
  };
}

export function filterArsenal(data: any[], s: BoardState): any[] {
  const { filters, colFilters, sortBy, sortDir } = s as BoardState & { filters: Record<string, any> };
  // A copy: on the server `data` is shared across requests, and it is sorted below.
  let rows = [...data];
  if (filters.team) rows = rows.filter((r) => r.team === filters.team);
  if (filters.season) rows = rows.filter((r) => String(r.season) === String(filters.season));
  // Slot band: the select shows the band label; a bare key (URL) works too.
  if (filters.band) {
    const b = SLOT_BANDS.find((x) => x.label === filters.band || x.key === filters.band);
    rows = rows.filter((r) => r.band === b?.key);
  }
  if (filters.minPitches > 0) rows = rows.filter((r) => (r.n_pitches || 0) >= filters.minPitches);
  if (filters.minUsage > 0) rows = rows.filter((r) => (r.usage || 0) >= filters.minUsage);
  if (filters.minVelo > 0) rows = rows.filter((r) => (r.velo || 0) >= filters.minVelo);
  rows = applyFilters(rows, colFilters, ARSENAL_FILTER_COLUMNS);

  // `?? 0` was once here, and it made a blank cell rank as a real zero.
  // Pitching+ runs ~85..115, so a fake 0 beat every pitcher on the board. Null
  // means the same thing to compareValues() that it means everywhere else.
  rows.sort((a, b) => compareValues(a[sortBy], b[sortBy], sortDir));
  return rows;
}

export function queryArsenal(data: any[], s: BoardState): BoardPage<any> {
  const p = pageOf(filterArsenal(data, s), s.page);
  return { ...p, rows: project(p.rows, ARSENAL_ROW_KEYS) };
}

/** Server-page props: meta and the default first page, never the full array. */
export const arsenalProps = (data: any[]) => ({ meta: arsenalMeta(data), initial: queryArsenal(data, ARSENAL_DEFAULTS) });
