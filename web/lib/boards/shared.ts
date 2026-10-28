/**
 * Server-side paging for the three big leaderboards (/hitters, /pitchers, /arsenal/[pitch]).
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * Each board used to receive its whole export as a client prop and filter, sort
 * and page it in the browser to show 25 rows: hitters.json is 12,447 rows x 95
 * keys (21.4 MB), pitchers.json 9,320 x 77 (12.5 MB), arsenal/ff.json 9,226 x 69
 * (11 MB). Next serializes props into the RSC payload, so every board cost tens
 * of MB of browser heap before a row rendered. The server already holds the
 * parsed file (lib/r2.ts caches files >2 MB for 5 min), so the same work there
 * is 3-30 ms per request and the browser gets one page. Page props went from
 * 21.4 MB / 12.7 MB / 11.4 MB (hitters / pitchers / arsenal FF) to 34 / 37 /
 * 30 KB of filter meta plus the first page; each later page is 20-27 KB.
 *
 * The filter/sort code in lib/boards/<board>.ts is the client code it replaced,
 * moved, not rewritten: __tests__/board-query-parity.test.ts holds the old code
 * as an oracle and requires the same ids in the same order on the real export.
 *
 * Pure module: imported by the client tables (constants, toParams), the pages
 * and the route handlers. Nothing server-only may be imported here.
 */
import { decodeFilters, encodeFilters, type ActiveFilter, type FilterColumn } from "@/lib/column-filters";
import { disciplineMetric } from "@/lib/discipline";
import type { SortDir } from "@/lib/table-sort";

export { filterMeta, type FilterMeta } from "@/lib/column-filters";

export const PAGE_SIZE = 25;
/** Longer than any name + team; a cap so a hostile query cannot make every row scan a megabyte. */
export const MAX_SEARCH = 100;

type Val = string | number | boolean;

export interface BoardState {
  search: string;
  /** The FilterPanel record (useUrlRecord), typed by its defaults. */
  filters: Record<string, Val>;
  /** "+ Add filter" (useUrlFilters). */
  colFilters: ActiveFilter[];
  sortBy: string;
  sortDir: SortDir;
  page: number;
}

export interface BoardPage<R> {
  rows: R[];
  total: number;
  page: number;
  totalPages: number;
}

/** Sorted distinct non-blank values of one key — the team / conference pick-lists. */
export const distinct = (rows: object[], key: string) =>
  [...new Set((rows as Record<string, unknown>[]).map((r) => r[key]).filter((v): v is string => Boolean(v)))].sort();

export function pageOf<R>(sorted: R[], page: number): BoardPage<R> {
  return {
    rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: sorted.length,
    page,
    totalPages: Math.ceil(sorted.length / PAGE_SIZE),
  };
}

/**
 * The keys a board's cells read: id, name, team, every column, and for a
 * discipline column its shrunk twin and denominator (lib/discipline gates read
 * both). Measured on the real export, a 25-row page: hitters 23.6 KB against
 * ~43 KB unprojected, pitchers 26.7 KB against ~34 KB.
 */
export function rowKeys(role: "hitter" | "pitcher", columnKeys: string[], extra: string[] = []): string[] {
  const keys = new Set(["id", "name", "team", ...columnKeys, ...extra]);
  for (const k of columnKeys) {
    const m = disciplineMetric(role, k);
    if (m) { keys.add(`${k}Shrunk`); keys.add(m.denom); }
  }
  return [...keys];
}

export function project<R extends object>(rows: R[], keys: string[]): R[] {
  return rows.map((r) => {
    const src = r as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in src) out[k] = src[k];
    return out as R;
  });
}

/**
 * State -> query string. Filters that equal their default are left out, and
 * the string is the TanStack Query key, so it must be canonical: the same view
 * always serializes the same way (an added-but-empty column filter encodes to
 * nothing and therefore does not refetch).
 */
export function toParams(s: BoardState, defaults: BoardState): string {
  const q = new URLSearchParams();
  if (s.search) q.set("search", s.search);
  for (const [k, d] of Object.entries(defaults.filters)) {
    const v = s.filters[k];
    if (v === d || v === undefined || v === null) continue;
    q.set(k, typeof d === "boolean" ? (v ? "1" : "0") : String(v));
  }
  const f = encodeFilters(s.colFilters);
  if (f) q.set("f", f);
  if (s.sortBy !== defaults.sortBy) q.set("sortBy", s.sortBy);
  if (s.sortDir !== defaults.sortDir) q.set("sortDir", s.sortDir);
  if (s.page !== 1) q.set("page", String(s.page));
  return q.toString();
}

/** Query string -> state, validated: unknown sort keys and filter keys fall back to defaults, page >= 1, search capped. */
export function fromParams(q: URLSearchParams, defaults: BoardState, sortKeys: readonly string[], filterColumns: FilterColumn[]): BoardState {
  const filters: Record<string, Val> = { ...defaults.filters };
  for (const [k, d] of Object.entries(defaults.filters)) {
    const v = q.get(k);
    if (v === null) continue;
    if (typeof d === "number") { const n = Number(v); if (Number.isFinite(n)) filters[k] = n; }
    else if (typeof d === "boolean") filters[k] = v === "1";
    else filters[k] = v.slice(0, MAX_SEARCH);
  }
  const allowed = new Set(filterColumns.map((c) => c.key));
  const sortBy = q.get("sortBy") ?? defaults.sortBy;
  const dir = q.get("sortDir");
  const page = Math.floor(Number(q.get("page") ?? 1));
  return {
    search: (q.get("search") ?? "").slice(0, MAX_SEARCH),
    filters,
    colFilters: decodeFilters(q.get("f")?.slice(0, 4000)).filter((f) => allowed.has(f.key)),
    sortBy: sortKeys.includes(sortBy) ? sortBy : defaults.sortBy,
    sortDir: dir === "asc" || dir === "desc" ? dir : defaults.sortDir,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
  };
}
