"use client";

import { useMemo, useState } from "react";
import { PlayerLink } from "@/components/ui/player-transition";
import { BorderBeam } from "border-beam";
import { FilterPanel } from "@/components/filter-panel";
import { useUrlRecord } from "@/lib/use-url-record";
import { PctChip } from "@/components/ui/shared-ui";
import {
  HITTER_DEFAULTS, HITTER_FILTER_COLUMNS, HITTER_QUALITY_COLUMNS, HITTER_RESULT_COLUMNS,
  shrunkSortKey, type HittersMeta, type HittersPage,
} from "@/lib/boards/hitters";
import { getStatPercentileRank } from "@/lib/percentiles";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import type { FilterColumn } from "@/lib/column-filters";
import { FilterBuilder, useUrlFilters } from "@/components/ui/filter-builder";
import { PAGE_SIZE } from "@/lib/boards/shared";
import { useBoardPage } from "@/lib/boards/use-board-page";

const CHIP_KEYS = new Set(["woba", "obp", "slg", "ev90", "hardHitPct", "barrelPct", "whiffPct", "oSwingPct", "xwoba", "batSpeed", "squaredUpPct", "sprintSpeed"]);

function fmt(value: any, key: string): string {
  if (value === null || value === undefined) return "—";
  if (key === "name" || key === "team" || key === "bats" || key === "season") return String(value);
  if (typeof value !== "number" || isNaN(value)) return "—";
  if (key === "age") return String(Math.floor(value)); // season age (June 30), shown as whole years
  if (key === "avg" || key === "obp" || key === "slg" || key === "ops" || key === "iso" || key === "woba") return value.toFixed(3).replace(/^0/, "");
  if (key.endsWith("Pct")) return value.toFixed(1);
  if (["ev90", "maxEv"].includes(key)) return value.toFixed(1);
  return String(value);
}

export function HittersTable({ meta, initial, percentiles }: {
  meta: HittersMeta;
  initial: HittersPage;
  /** percentiles.json hitters section: by_season pct5 + dense (from the page). */
  percentiles?: any;
}) {
  const [sortBy, setSortBy] = useState("woba");
  const [colFilters, setColFilters] = useUrlFilters();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useUrlRecord<Record<string, any>>({ team: "", season: "", bats: "", minPA: 100, minEv90: 0 });
  const { teams, seasons } = meta;

  const filterDefs = useMemo(() => [
    { key: "team", label: "Team", type: "select" as const, options: teams },
    { key: "season", label: "Season", type: "select" as const, options: seasons.map(String) },
    { key: "bats", label: "Bats", type: "toggle" as const, options: ["R", "L", "S"] },
    { key: "minPA", label: "Min PA", type: "range" as const, min: 0, max: 500, step: 25 },
    { key: "minEv90", label: "Min EV90", type: "range" as const, min: 0, max: 110, step: 2 },
  ], [teams, seasons]);

  const { data: res, fetching, error } = useBoardPage(
    "/api/data/board/hitters",
    { search, filters, colFilters, sortBy, sortDir, page },
    HITTER_DEFAULTS,
    initial,
  );
  const total = res?.total ?? 0;
  const totalPages = res?.totalPages ?? 0;
  const pageData = (res?.rows ?? []) as any[];
  const rankBase = ((res?.page ?? page) - 1) * PAGE_SIZE;
  const columns = [...HITTER_RESULT_COLUMNS, ...HITTER_QUALITY_COLUMNS];
  const groupStarts = new Set<number>([HITTER_RESULT_COLUMNS.length]);

  function handleSort(key: string) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir(key === "kPct" || key === "whiffPct" || key === "oSwingPct" ? "asc" : "desc");
    }
    setPage(1);
  }

  const tipOf = (key: string): string | undefined =>
    (HITTER_QUALITY_COLUMNS as readonly { key: string; tip?: string }[]).find((c) => c.key === key)?.tip;

  const chipFor = (row: any, key: string, value: any) => {
    if (!CHIP_KEYS.has(key) || typeof value !== "number") return null;
    const bp = percentiles?.by_season?.[String(row.season)]?.[key];
    if (!bp) return null;
    const rank = getStatPercentileRank(key, value, bp);
    return <PctChip p={rank} title={`${rank}th percentile among ${row.season} hitters (50+ PA)`} />;
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap relative z-10 animate-fade-up stagger-1">
        <input
          type="text"
          placeholder="Search hitters..."
          aria-label="Search hitters by name"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-[200px] px-3 py-1.5 rounded-full text-sm bg-white/[0.04] border border-border-subtle text-text-primary placeholder:text-text-dim focus:border-border-emphasis transition-all"
        />
        <FilterPanel
          filters={filterDefs}
          values={filters}
          onChange={(key, value) => { setFilters({ ...filters, [key]: value }); setPage(1); }}
          onReset={() => { setFilters({ team: "", season: "", bats: "", minPA: 100, minEv90: 0 }); setPage(1); }}
        />
      </div>

      <FilterBuilder meta={meta.filters} columns={HITTER_FILTER_COLUMNS as FilterColumn[]} active={colFilters}
                     onChange={(next) => { setColFilters(next); setPage(1); }} />

      {error && <p role="alert" className="text-xs text-[#E84142]">Could not load this view. Change a filter or reload to retry.</p>}
      <p className="text-xs text-text-dim animate-fade-up stagger-2">
        Showing {total} hitter-seasons · sorted by{" "}
        <span className="text-text-secondary">{columns.find((c) => c.key === sortBy)?.label || sortBy}</span>{" "}
        ({sortDir})
        {shrunkSortKey(sortBy) ? " · sample-adjusted order (raw rate printed; thin samples pulled toward the league)" : ""}
      </p>

      <BorderBeam size="md" duration={8} colorVariant="ocean" theme="dark" strength={0.4}>
      <div className="glass-panel overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.2)] animate-fade-up stagger-3">
        <div className={`max-h-[calc(100vh-280px)] overflow-auto transition-opacity ${fetching ? "opacity-60" : ""}`} aria-busy={fetching}>
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              {total} hitter-seasons, sorted by {columns.find((c) => c.key === sortBy)?.label ?? sortBy} {sortDir === "desc" ? "descending" : "ascending"}. Page {page} of {totalPages}.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 z-10 bg-surface-1 w-[32px] border-b border-border-subtle px-0 py-2.5 text-center text-[10px] font-medium text-text-dim">
                  #<span className="sr-only"> rank on this page</span>
                </th>
                {columns.map((col, ci) => (
                  <th key={col.key} scope="col"
                    aria-sort={sortBy === col.key ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
                    className={`${col.w} sticky top-0 z-10 bg-surface-1 border-b border-border-subtle p-0 ${groupStarts.has(ci) ? "border-l border-border-subtle" : ""}`}>
                    <button type="button" onClick={() => handleSort(col.key)} title={tipOf(col.key)}
                      className={`w-full px-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${sortBy === col.key ? "text-usf-gold" : "text-text-dim hover:text-text-secondary"} ${groupStarts.has(ci) ? "pl-2" : ""}`}>
                      {col.label}
                      {sortBy === col.key && <span className="ml-0.5 text-[10px]" aria-hidden="true">{sortDir === "desc" ? "▼" : "▲"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((row, i) => (
                <tr key={`${row.id}-${row.season}`}
                  className={`border-b border-white/[0.025] hover:bg-white/[0.04] transition-colors ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`}
                  style={{ height: "36px" }}>
                  <td className="w-[32px] border-b border-white/[0.025] text-center text-[11px] text-text-dim font-data">
                    {rankBase + i + 1}
                  </td>
                  {columns.map((col, ci) => {
                    const raw = row[col.key];
                    const value = fmt(raw, col.key);
                    const isName = col.key === "name";
                    const isHighlighted = col.key === sortBy && !isName && col.key !== "team";
                    const isBorder = groupStarts.has(ci);
                    const Tag = isName ? "th" : "td";
                    return (
                      <Tag key={col.key}
                        {...(isName ? { scope: "row" as const } : {})}
                        className={`${col.w} border-b border-white/[0.025] px-1 text-xs font-normal truncate ${
                          col.align === "right" ? "text-right font-data" : "text-left"
                        } ${isName ? "text-text-primary font-medium" : "text-text-secondary"} ${isHighlighted ? "text-usf-gold" : ""} ${isBorder ? "border-l border-border-subtle pl-2" : ""}`}
                        title={isName ? value : tipOf(col.key)}>
                        {isName ? (
                          <PlayerLink href={`/player/${row.id}?season=${row.season}`} info={{ name: row.name, team: row.team, teamName: row.team, pos: "Hitter" }} className="hover:underline">
                            <PixelTeamLogo team={row.team} size={16} className="mr-1.5" />
                            {value}
                          </PlayerLink>
                        ) : value}
                        {chipFor(row, col.key, raw)}
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <p className="text-[11px] text-text-dim">Page {page} of {totalPages} · {total} results</p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">← Prev</button>
            <span className="px-2.5 py-1 text-[11px] rounded bg-usf-green/20 text-usf-gold border border-usf-green/30 font-data">{page}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">Next →</button>
          </div>
        </div>
      </div>
      </BorderBeam>
    </>
  );
}
