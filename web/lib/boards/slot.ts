/**
 * /arsenal?view=slot: pitchers grouped by arm slot, for one pitch type at a
 * time. MVP surface per docs/parity-matrix.md (A3 release + A4 grades): the
 * slot file's release columns joined to the arsenal rows' grades, plus the
 * whiff±slot pair (wave 4): his Whiff% minus same-band peers' for this pitch
 * and for all his pitches, shrunk toward 0 with the measured whiff half-signal
 * (MLB split-half, lib/measured-mlb-constants). The xRV column stays deleted
 * (NEEDS-MODEL).
 *
 * Pure module (client columns + server filter/sort), same split as
 * lib/boards/arsenal.ts.
 */
import { applyFilters, type FilterColumn } from "@/lib/column-filters";
import { SLOT_BANDS, slotBand } from "@/lib/arm-slot";
import { GRADE_PCT_FLOOR } from "@/lib/percentiles";
import { MLB_HALF_PITCHER } from "@/lib/measured-mlb-constants";
import { compareValues } from "@/lib/table-sort";
import { distinct, filterMeta, pageOf, project, rowKeys, type BoardPage, type BoardState, type FilterMeta } from "./shared";

export interface SlotBoardPitcher {
  th: "L" | "R"; arm: number; armType: string;
  /** feet; relS is arm-side positive for both hands */
  relH: number | null; relS: number | null; ext: number | null;
  fb: string | null; fbVelo: number | null; fbIvb: number | null; fbHb: number | null;
}
export interface SlotBoardFile { season: number; pitchers: Record<string, SlotBoardPitcher> }

/** The arsenal pitch types (one file each under arsenal/). */
export const SLOT_PITCH_TYPES = ["FF", "SI", "FC", "SL", "SW", "CU", "KC", "CH", "FS"] as const;
export const ARM_MIN = -90, ARM_MAX = 101;

export const SLOT_COLS = [
  { key: "name", label: "Name", w: "min-w-[140px]", align: "left" },
  { key: "team", label: "Team", w: "w-[64px]", align: "left" },
  { key: "season", label: "Yr", w: "w-[44px]", align: "right" },
  { key: "throws", label: "T", w: "w-[28px]", align: "left", tip: "Throws" },
  { key: "band", label: "Slot", w: "w-[70px]", align: "left", tip: "Arm-angle band of his primary fastball" },
  { key: "arm", label: "Arm°", w: "w-[48px]", align: "right", tip: "Arm angle on his primary fastball: 0 sidearm, 90 over the top" },
  { key: "relH", label: "RelH", w: "w-[44px]", align: "right", tip: "Release height, feet" },
  { key: "relS", label: "RelS", w: "w-[44px]", align: "right", tip: "Release side, feet toward his arm side" },
  { key: "ext", label: "Ext", w: "w-[40px]", align: "right", tip: "Extension on this pitch, feet" },
  { key: "fbVelo", label: "FB velo", w: "w-[52px]", align: "right", tip: "Primary fastball (four-seam, sinker or cutter, whichever he throws most)" },
  { key: "fbIvb", label: "FB IVB", w: "w-[50px]", align: "right", tip: "Primary fastball induced vertical break, inches" },
  { key: "fbHb", label: "FB HB", w: "w-[48px]", align: "right", tip: "Primary fastball horizontal break, inches, pitcher's view" },
  { key: "n_pitches", label: "N", w: "w-[40px]", align: "right" },
  { key: "usage", label: "Usage", w: "w-[48px]", align: "right" },
  { key: "velo", label: "Velo", w: "w-[44px]", align: "right" },
  { key: "ivb", label: "IVB", w: "w-[42px]", align: "right" },
  { key: "hb", label: "HB", w: "w-[42px]", align: "right", tip: "Horizontal break, inches, pitcher's view" },
  { key: "whiffPct", label: "Whiff%", w: "w-[56px]", align: "right" },
  { key: "whiffVsSlot", label: "Whiff±slot", w: "w-[64px]", align: "right", tip: "This pitch: his Whiff% minus same-band peers' (50+ swings pooled, himself excluded), in points, pulled toward 0 on few swings" },
  { key: "whiffVsSlotAll", label: "Whiff±slot all", w: "w-[66px]", align: "right", tip: "All his pitches: his Whiff% minus same-band peers' overall Whiff%, in points, pulled toward 0 on few swings" },
  { key: "cswPct", label: "CSW%", w: "w-[52px]", align: "right" },
  { key: "stuffPlus", label: "Whiff+", w: "w-[76px]", align: "right", model: true },
  { key: "stuffPlusSlotPct", label: "Slot pct", w: "w-[52px]", align: "right", model: true, tip: "Whiff+ percentile among MLB pitchers in his slot band throwing this pitch" },
  { key: "pitchingPlus", label: "Pitching+", w: "w-[84px]", align: "right", model: true },
  { key: "pitchingPlusSlotPct", label: "Slot pct", w: "w-[52px]", align: "right", model: true, tip: "Pitching+ percentile among MLB pitchers in his slot band throwing this pitch" },
] as const;

export const SLOT_GRADES = ["stuffPlus", "pitchingPlus"] as const;

export const SLOT_FILTER_DEFAULTS = {
  pt: "FF", band: "", season: "", armMin: ARM_MIN, armMax: ARM_MAX, team: "", throws: "", minPitches: 0, minUsage: 0, minVelo: 0,
};
export const SLOT_DEFAULTS: BoardState = {
  search: "", filters: SLOT_FILTER_DEFAULTS, colFilters: [], sortBy: "stuffPlus", sortDir: "desc", page: 1,
};
export const SLOT_FILTER_COLUMNS: FilterColumn[] = SLOT_COLS.filter((c) => c.key !== "name" && c.key !== "band").map((c) => ({
  key: c.key, label: c.label === "Slot pct" ? `${c.key.replace("SlotPct", "")} slot pct` : c.label,
  group: "model" in c && c.model ? "Models (descriptive)" : "Release & shape",
}));
export const SLOT_SORT_KEYS = SLOT_COLS.map((c) => c.key as string);
export const SLOT_ROW_KEYS = rowKeys("pitcher", SLOT_SORT_KEYS, [
  "band", "nStuffPitches", "fb", "armType", "whiffPct", "nSwings",
  "whiffVsSlot", "whiffVsSlotAll", "whiffSlotPeer", "whiffAll",
  ...SLOT_GRADES.flatMap((g) => [`${g}SlotRank`, `${g}SlotN`]),
]);

/** What a row's card reads. */
export const SLOT_CARD_KEYS = [
  "id", "name", "team", "throws", "arm", "band", "relH", "relS", "ext", "velo", "ivb", "hb",
  "nStuffPitches", ...SLOT_GRADES.flatMap((g) => [g, `${g}SlotPct`, `${g}SlotRank`, `${g}SlotN`]),
];

const pitchOf = (s: BoardState) => {
  const pt = String(s.filters.pt ?? "FF").toUpperCase();
  return (SLOT_PITCH_TYPES as readonly string[]).includes(pt) ? pt : "FF";
};

const nOf = (r: any) => r.nStuffPitches ?? r.n_pitches ?? null;
/** The slot file's overall [whiffs, swings, pitches] for a joined row. */
const sWs = (r: any): { sw: number; wh: number } => {
  const ws = r._ws as [number, number, number] | undefined;
  return { sw: ws?.[1] ?? 0, wh: ws?.[0] ?? 0 };
};

/**
 * Arsenal rows for one type, joined to the slot file. Only pitchers with a slot
 * survive. The join is deliberately shallow: release columns come from the slot
 * file, everything else from the arsenal rows, so a grade can never disagree
 * between the two boards.
 */
export function joinSlot(arsenal: any[], board: SlotBoardFile | null, pt: string): any[] {
  const P = board?.pitchers ?? {};
  const rows: any[] = [];
  for (const a of arsenal) {
    const s = P[String(a.id)];
    if (!s || typeof s.arm !== "number") continue;
    rows.push({
      ...a, throws: s.th, arm: s.arm, armType: s.armType, band: slotBand(s.arm).key,
      relH: s.relH, relS: s.relS, ext: a.ext ?? s.ext, fb: s.fb, fbVelo: s.fbVelo, fbIvb: s.fbIvb, fbHb: s.fbHb,
      _ws: (s as any).ws,
    });
  }
  // Whiff vs same-band peers. Peer = leave-one-out pooled Whiff% of the band
  // (>= 50 swings), one pool per season|band for the pitch and for all pitches.
  // The difference is shrunk toward 0 by swings/(swings + half-signal): a
  // 10-swing +-40 does not survive contact with its own noise.
  const WHIFF_HALF = MLB_HALF_PITCHER.whiffPct ?? 179;
  const WHIFF_PEER_MIN = 50;
  const pool = (rowsOf: any[], swingsOf: (r: any) => number, whiffsOf: (r: any) => number) => {
    const m = new Map<string, { sw: number; wh: number }>();
    for (const r of rowsOf) {
      const sw = swingsOf(r), wh = whiffsOf(r);
      if (sw <= 0) continue;
      const k = `${r.season}|${r.band}`;
      const cur = m.get(k) ?? { sw: 0, wh: 0 };
      cur.sw += sw; cur.wh += wh;
      m.set(k, cur);
    }
    return m;
  };
  const ptPool = pool(rows, (r) => r.nSwings ?? 0, (r) => r.nWhiffs ?? 0);
  const allPool = pool(rows, (r) => sWs(r).sw, (r) => sWs(r).wh);
  for (const r of rows) {
    const kk = `${r.season}|${r.band}`;
    const mine = (r.nSwings ?? 0) > 0 && typeof r.whiffPct === "number" ? r.whiffPct : null;
    const pt = ptPool.get(kk);
    const ptPeer = pt && pt.sw - (r.nSwings ?? 0) >= WHIFF_PEER_MIN
      ? 100 * (pt.wh - (r.nWhiffs ?? 0)) / (pt.sw - (r.nSwings ?? 0)) : null;
    if (mine !== null && ptPeer !== null) {
      r.whiffSlotPeer = Math.round(ptPeer * 10) / 10;
      r.whiffVsSlot = Math.round((mine - ptPeer) * ((r.nSwings ?? 0) / ((r.nSwings ?? 0) + WHIFF_HALF)) * 10) / 10;
    } else { r.whiffVsSlot = null; }
    const w = sWs(r);
    const all = allPool.get(kk);
    const allPeer = all && all.sw - w.sw >= WHIFF_PEER_MIN ? 100 * (all.wh - w.wh) / (all.sw - w.sw) : null;
    if (w.sw > 0 && allPeer !== null) {
      r.whiffAll = Math.round((100 * w.wh / w.sw) * 10) / 10;
      r.whiffSlotPeerAll = Math.round(allPeer * 10) / 10;
      r.whiffVsSlotAll = Math.round((100 * w.wh / w.sw - allPeer) * (w.sw / (w.sw + WHIFF_HALF)) * 10) / 10;
    } else { r.whiffVsSlotAll = null; }
  }

  // Within-slot rank: among this type's rows in the same band with a rankable
  // grade (the percentile chip's floor). Never across bands: a sidearm slider
  // ranks against sidearm sliders.
  const key = (r: any) => `${r.season}|${r.band}`;
  for (const g of SLOT_GRADES) {
    const byBand = new Map<string, number[]>();
    const ok = (r: any) => typeof r[g] === "number" && (nOf(r) ?? 0) >= GRADE_PCT_FLOOR.type;
    for (const r of rows) if (ok(r)) (byBand.get(key(r)) ?? byBand.set(key(r), []).get(key(r))!).push(r[g]);
    for (const r of rows) {
      const v = byBand.get(key(r));
      if (!ok(r) || !v) { r[`${g}SlotPct`] = null; continue; }
      let below = 0, eq = 0;
      for (const x of v) { if (x < r[g]) below++; else if (x === r[g]) eq++; }
      r[`${g}SlotPct`] = Math.round((100 * (below + eq / 2)) / v.length);
      r[`${g}SlotRank`] = v.length - below - eq + 1;
      r[`${g}SlotN`] = v.length;
    }
  }
  return rows;
}

/** Every filter except the arm range: what the band counts are taken over. */
function baseFilter(rows: any[], s: BoardState): any[] {
  const f = s.filters as typeof SLOT_FILTER_DEFAULTS;
  let out = rows;
  if (f.band) out = out.filter((r) => r.band === f.band);
  if (f.season) out = out.filter((r) => String(r.season) === String(f.season));
  if (f.team) out = out.filter((r) => r.team === f.team);
  if (f.throws) out = out.filter((r) => r.throws === f.throws);
  if (f.minPitches > 0) out = out.filter((r) => (r.n_pitches || 0) >= f.minPitches);
  if (f.minUsage > 0) out = out.filter((r) => (r.usage || 0) >= f.minUsage);
  if (f.minVelo > 0) out = out.filter((r) => (r.velo || 0) >= f.minVelo);
  return applyFilters(out, s.colFilters, SLOT_FILTER_COLUMNS);
}

export interface SlotPage extends BoardPage<any> {
  pt: string; bandCounts: Record<string, number>;
}

export function querySlot(joined: any[], s: BoardState): SlotPage {
  const f = s.filters as typeof SLOT_FILTER_DEFAULTS;
  const base = baseFilter(joined, s);
  const bandCounts: Record<string, number> = Object.fromEntries(SLOT_BANDS.map((b) => [b.key, 0]));
  for (const r of base) if (r.band in bandCounts) bandCounts[r.band]++;
  const lo = Math.min(f.armMin, f.armMax), hi = Math.max(f.armMin, f.armMax);
  const rows = base.filter((r) => r.arm >= lo && r.arm < hi);
  rows.sort((a, b) => compareValues(a[s.sortBy], b[s.sortBy], s.sortDir));
  const p = pageOf(rows, s.page);
  return { ...p, rows: project(p.rows, SLOT_ROW_KEYS), pt: pitchOf(s), bandCounts };
}

export const slotPitchOf = pitchOf;

export interface SlotMeta { season: string | null; teams: string[]; seasons: number[]; filters: FilterMeta }

export function slotMeta(board: SlotBoardFile | null, joined: any[]): SlotMeta {
  return {
    season: board?.season ? String(board.season) : null,
    teams: distinct(joined, "team"),
    seasons: [...new Set(joined.map((r) => r.season))].sort((a: number, b: number) => b - a),
    filters: filterMeta(joined, SLOT_FILTER_COLUMNS),
  };
}
