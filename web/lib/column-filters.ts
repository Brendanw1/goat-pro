/**
 * Leaderboard column filters: any column a board displays can be filtered.
 *
 * Type is decided from the data, not declared: a column whose non-blank values
 * are all numbers gets a min/max range; one holding a few distinct strings gets
 * a pick-list. Owner decisions (2026-09-27): min AND max, both optional; a row
 * with no value for a filtered column is hidden while that filter is active;
 * filters live in the URL so a view can be shared.
 */

export interface FilterColumn {
  key: string;
  label: string;
  group: string;
  /** The value the cell shows. Defaults to row[key]. */
  get?: (row: Record<string, unknown>) => unknown;
}

export interface ActiveFilter {
  key: string;
  min?: number;
  max?: number;
  /** Category filters: the values kept. */
  values?: string[];
}

export type Kind = "number" | "category" | null;
const MAX_CATEGORIES = 60;

export const valueOf = (row: Record<string, unknown>, c: FilterColumn) => (c.get ? c.get(row) : row[c.key]);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const blank = (v: unknown) => v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v));

export function kindOf(rows: Record<string, unknown>[], c: FilterColumn): Kind {
  let nums = 0, strs = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const v = valueOf(r, c);
    if (blank(v)) continue;
    if (isNum(v)) nums++;
    else if (typeof v === "string") { strs++; seen.add(v); }
  }
  if (nums > 0 && strs === 0) return "number";
  if (strs > 0 && nums === 0 && seen.size <= MAX_CATEGORIES) return "category";
  return null;
}

export function rangeOf(rows: Record<string, unknown>[], c: FilterColumn): { min: number; max: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) { const v = valueOf(r, c); if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  return lo <= hi ? { min: lo, max: hi } : null;
}

export function categoriesOf(rows: Record<string, unknown>[], c: FilterColumn): string[] {
  const s = new Set<string>();
  for (const r of rows) { const v = valueOf(r, c); if (typeof v === "string" && v) s.add(v); }
  return [...s].sort();
}

/**
 * What FilterBuilder needs per usable column, computed once. The paged boards
 * compute it on the server over the full export and send this instead of the
 * rows (lib/boards/shared.ts); a board that still holds its rows derives it
 * client-side, so both paths share one definition.
 */
export type FilterMeta = Record<string, { kind: "number"; range: { min: number; max: number } | null } | { kind: "category"; categories: string[] }>;

export function filterMeta(rows: object[], columns: FilterColumn[]): FilterMeta {
  const data = rows as Record<string, unknown>[];
  const out: FilterMeta = {};
  for (const c of columns) {
    const kind = kindOf(data, c);
    if (kind === "number") out[c.key] = { kind, range: rangeOf(data, c) };
    else if (kind === "category") out[c.key] = { kind, categories: categoriesOf(data, c) };
  }
  return out;
}

/** True when the filter constrains anything (an added-but-empty filter passes every row). */
export const isSet = (f: ActiveFilter) => f.min !== undefined || f.max !== undefined || (f.values?.length ?? 0) > 0;

export function applyFilters<T>(rows: T[], active: ActiveFilter[], columns: FilterColumn[]): T[] {
  const live = active.filter(isSet).map((f) => ({ f, c: columns.find((c) => c.key === f.key) })).filter((x) => x.c);
  if (live.length === 0) return rows;
  return rows.filter((row) => live.every(({ f, c }) => {
    const v = valueOf(row as Record<string, unknown>, c!);
    if (blank(v)) return false;                           // blanks drop out while filtered
    if (f.values?.length) return f.values.includes(String(v));
    if (!isNum(v)) return false;
    return (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max);
  }));
}

/** URL form: `stuffPlus:110~;velo:92~97;era:~3.5;year=Jr|Sr`. */
export function encodeFilters(active: ActiveFilter[]): string {
  return active.filter(isSet).map((f) => f.values?.length
    ? `${f.key}=${f.values.map(encodeURIComponent).join("|")}`
    : `${f.key}:${f.min ?? ""}~${f.max ?? ""}`).join(";");
}

export function decodeFilters(s: string | null | undefined): ActiveFilter[] {
  if (!s) return [];
  const out: ActiveFilter[] = [];
  for (const part of s.split(";")) {
    const cat = /^([A-Za-z0-9_]+)=(.+)$/.exec(part);
    if (cat) { out.push({ key: cat[1], values: cat[2].split("|").map(decodeURIComponent) }); continue; }
    const num = /^([A-Za-z0-9_]+):(-?[\d.]*)~(-?[\d.]*)$/.exec(part);
    if (num) {
      const f: ActiveFilter = { key: num[1] };
      if (num[2] !== "" && Number.isFinite(Number(num[2]))) f.min = Number(num[2]);
      if (num[3] !== "" && Number.isFinite(Number(num[3]))) f.max = Number(num[3]);
      if (isSet(f)) out.push(f);
    }
  }
  return out;
}
