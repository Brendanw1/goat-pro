"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { FilterPanel } from "@/components/filter-panel";
import { PITCH_CONFIG } from "@/lib/constants";
import { GradePct, gradedN } from "@/components/ui/grade-pct";
import type { FilterColumn } from "@/lib/column-filters";
import { FilterBuilder, useUrlFilters } from "@/components/ui/filter-builder";
import {
  ARSENAL_DEFAULTS, ARSENAL_FILTER_COLUMNS, ARSENAL_FILTER_DEFAULTS, COLS, type ArsenalMeta,
} from "@/lib/boards/arsenal";
import { PITCHING_TIP, STUFF_TIP, gradeColor } from "@/lib/grades";
import { RV100_TIP } from "@/lib/rv-cells";
import { SLOT_BANDS } from "@/lib/arm-slot";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { GyroTag } from "@/components/ui/shared-grade-note";
import { PAGE_SIZE, type BoardPage } from "@/lib/boards/shared";
import { useBoardPage } from "@/lib/boards/use-board-page";

// Columns, defaults and the filter/sort live in lib/boards/arsenal.ts, shared
// with the route that pages this board on the server.

function fmt(value: any, key: string): string {
  if (value === null || value === undefined) return "—";
  if (key === "spin") return String(Math.round(value));
  if (key === "n_pitches") return String(Math.round(value));
  if (key === "age") return String(Math.floor(value)); // season age (June 30), whole years as on the pitchers board
  if (["stuffPlus", "pitchingPlus", "prevPitch", "deceptionPlus"].includes(key)) return Math.round(value).toString();
  if (key === "dIvbSlot" || key === "dHbSlot") return (value > 0 ? "+" : "") + value.toFixed(1);
  if (key === "season") return String(Math.round(value));
  if (key === "rv100") return (value > 0 ? "+" : "") + value.toFixed(2);
  if (key.endsWith("Pct")) return value.toFixed(1);
  if (["usage", "velo", "ivb", "hb", "vaa", "ext"].includes(key)) return value.toFixed(1);
  return String(value);
}

export function ArsenalExpanded({
  pitchType,
  meta,
  initial,
  breakpoints,
}: {
  pitchType: string;
  meta: ArsenalMeta;
  /** The default first page, computed by the server page. */
  initial: BoardPage<any>;
  /** Dense percentile breakpoints for THIS pitch type (stuff_percentiles.json per_type). */
  breakpoints?: Record<string, any> | null;
}) {
  const config = PITCH_CONFIG[pitchType as keyof typeof PITCH_CONFIG] || PITCH_CONFIG.FF;
  const [sortBy, setSortBy] = useState("stuffPlus");
  const [colFilters, setColFilters] = useUrlFilters();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const columns = COLS;

  // Filters
  const [filters, setFilters] = useState<Record<string, any>>(ARSENAL_FILTER_DEFAULTS);

  const { teams } = meta;

  const filterDefs = useMemo(() => [
    { key: "team", label: "Team", type: "select" as const, options: teams },
    { key: "season", label: "Season", type: "select" as const, options: meta.seasons.map(String) },
    { key: "band", label: "Arm slot", type: "select" as const, options: SLOT_BANDS.map((b) => b.label) },
    { key: "minPitches", label: "Min Pitches", type: "range" as const, min: 0, max: 200, step: 10 },
    { key: "minUsage", label: "Min Usage%", type: "range" as const, min: 0, max: 50, step: 5 },
    { key: "minVelo", label: "Min Velo", type: "range" as const, min: 0, max: 100, step: 1 },
  ], [teams]);

  // Filter, sort and page run on the server (lib/boards/arsenal.ts).
  const { data: res, fetching, error } = useBoardPage(
    `/api/data/board/arsenal/${pitchType}`,
    { search: "", filters, colFilters, sortBy, sortDir, page },
    ARSENAL_DEFAULTS,
    initial,
  );
  const total = res?.total ?? 0;
  const totalPages = res?.totalPages ?? 0;
  const pageData = res?.rows ?? [];
  // Ranks follow the rows on screen, which during a fetch are the previous page's.
  const rankBase = ((res?.page ?? page) - 1) * PAGE_SIZE;

  function handleSort(key: string) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(key); setSortDir("desc"); }
    setPage(1);
  }

  const tipOf = (key: string): string | undefined =>
    key === "stuffPlus" ? STUFF_TIP : key === "pitchingPlus" ? PITCHING_TIP : key === "rv100" ? RV100_TIP
      : (COLS.find((c) => c.key === key) as { tip?: string } | undefined)?.tip;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <BackLink
          fallback="/arsenal"
          className="px-3 py-1 rounded-lg text-xs bg-white/[0.05] border border-border-subtle text-text-secondary hover:bg-white/[0.08] transition-all"
        />
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: config.color }} />
          <h1 className="text-lg font-bold text-text-primary">{config.label}</h1>
          <span className="text-xs text-text-dim">({total} pitchers)</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 flex-wrap relative z-10">
        <FilterPanel
          filters={filterDefs}
          values={filters}
          onChange={(key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); }}
          onReset={() => { setFilters(ARSENAL_FILTER_DEFAULTS); setPage(1); }}
        />
      </div>

      <FilterBuilder meta={meta.filters} columns={ARSENAL_FILTER_COLUMNS as FilterColumn[]} active={colFilters}
                     onChange={(next) => { setColFilters(next); setPage(1); }} />

      {error && <p role="alert" className="text-xs text-[#E84142]">Could not load this view. Change a filter or reload to retry.</p>}

      <div className="glass-panel overflow-hidden">
        {/*
          A real table. The sort headers were `<div onClick>` and the row
          navigated to a profile on click in the fork source, so the leaderboard
          was mouse-only; the name is a link now.
        */}
        {/* Dimmed, never blanked, while the next view loads (the last one stays up). */}
        <div className={`overflow-x-auto transition-opacity ${fetching ? "opacity-60" : ""}`} aria-busy={fetching}>
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              {pitchType} leaderboard, sorted by{" "}
              {columns.find((c) => c.key === sortBy)?.label ?? sortBy}{" "}
              {sortDir === "desc" ? "descending" : "ascending"}. Page {page} of {totalPages}.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-[36px] border-b border-border-subtle px-0 py-2.5 text-center text-[10px] font-medium text-text-dim"
                >
                  #<span className="sr-only"> rank on this page</span>
                </th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      sortBy === col.key ? (sortDir === "desc" ? "descending" : "ascending") : "none"
                    }
                    className={`${col.w} border-b border-border-subtle p-0`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      title={tipOf(col.key)}
                      className={`w-full px-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${sortBy === col.key ? "text-usf-gold" : "text-text-dim hover:text-text-secondary"}`}
                    >
                      {col.label}
                      {sortBy === col.key && (
                        <span className="ml-0.5 text-[10px]" aria-hidden="true">
                          {sortDir === "desc" ? "▼" : "▲"}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((row, i) => (
                <tr
                  // Multi-season players appear once per season; an id-only key
                  // collides and React reconciliation scrambles the rows on sort.
                  key={`${row.id}-${row.season}-${i}`}
                  className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${
                    i % 2 === 1 ? "bg-white/[0.015]" : ""
                  }`}
                  style={{ height: "36px" }}
                >
                  <td className="w-[36px] border-b border-white/[0.03] text-center text-[11px] text-text-dim font-data">
                    {rankBase + i + 1}
                  </td>
                  {columns.map((col) => {
                    const raw = row[col.key];
                    const value = fmt(raw, col.key);
                    const isName = col.key === "name";
                    const isModel = "model" in col && col.model;
                    // Deception+ is good-high like the grades; ΔIVB / ΔHB vs slot stay uncoloured (a style).
                    const color = isModel || col.key === "deceptionPlus" ? gradeColor(raw) : undefined;
                    const gradeNote = (col.key === "dIvbSlot" || col.key === "dHbSlot") && typeof raw === "number"
                      ? (col.key === "dIvbSlot"
                        ? `IVB ${row.ivb} vs ${row.ivbSlotPeer} for his band`
                        : `Arm-side HB ${row.hbArm} vs ${row.hbSlotPeer} for his band`) + ` (${row.band})`
                      : isModel || col.key === "deceptionPlus" ? tipOf(col.key) : undefined;
                    return (
                      <td
                        key={col.key}
                        className={`${col.w} border-b border-white/[0.03] px-1.5 text-xs font-normal truncate ${
                          col.align === "right" ? "text-right font-data" : "text-left"
                        } ${isName ? "text-text-primary font-medium" : "text-text-secondary"}`}
                        style={color ? { color } : undefined}
                        title={isName ? value : gradeNote}
                      >
                        {isName ? (
                          <Link href={`/player/${row.id}?season=${row.season}`} className="hover:underline">
                            <PixelTeamLogo team={row.team} size={16} className="mr-1.5" />
                            {value}
                            {row.gyro ? <span className="ml-1.5"><GyroTag /></span> : null}
                          </Link>
                        ) : isModel && typeof raw === "number" ? (
                          <>
                            {Math.round(raw)}
                            <GradePct metric={col.key} value={raw} n={gradedN(row)} code={pitchType} season={row.season} />
                          </>
                        ) : (
                          value
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <p className="text-[11px] text-text-dim">Page {page} of {totalPages} · {total} results</p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">← Prev</button>
            <span className="px-2.5 py-1 text-[11px] rounded bg-usf-green/20 text-usf-gold border border-usf-green/30 font-data">{page}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">Next →</button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-text-dim">
        {breakpoints ? "Percentile chips rank each grade among that season's MLB pitchers' " : "No percentile population baked for "}
        {config.label.toLowerCase()} (50+ pitches of the type, that season).
        {" "}Whiff+ / Pitching+ are per pitch class × batter side: {config.label} rows share the class grade where types are pooled — the Shared-grade note on each profile says when.
      </p>
    </div>
  );
}
