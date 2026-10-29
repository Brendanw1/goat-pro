"use client";

import { Fragment, useState, useMemo } from "react";
import { PlayerLink } from "@/components/ui/player-transition";
import { BorderBeam } from "border-beam";
import { FilterPanel } from "@/components/filter-panel";
import { useUrlRecord } from "@/lib/use-url-record";
import { GradePct, gradedN } from "@/components/ui/grade-pct";
import { Signed } from "@/components/ui/shared-ui";
import {
  DISCIPLINE_COLUMNS, MODEL_COLUMNS, PITCHER_DEFAULTS, PITCHER_FILTER_COLUMNS, PITCHER_FILTER_DEFAULTS,
  TRAD_COLUMNS, shrunkSortKey, type PitchersMeta, type PitchersPage,
} from "@/lib/boards/pitchers";
import { PITCHING_TIP, K_TIP, PREVENTION_TIP, CONTROL_TIP, STUFF_TIP, gradeColor } from "@/lib/grades";
import { RV100_TIP } from "@/lib/rv-cells";
import { percentileColor, getPitcherPercentileRank, isNeutralStat } from "@/lib/percentiles";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { TeamCountButton, TeamSplitRows, multiTeam } from "@/components/ui/team-split-rows";
import type { FilterColumn } from "@/lib/column-filters";
import { FilterBuilder, useUrlFilters } from "@/components/ui/filter-builder";
import { PAGE_SIZE } from "@/lib/boards/shared";
import { useBoardPage } from "@/lib/boards/use-board-page";
import { fmtIp } from "@/lib/ip";

// Columns, defaults, the filter/sort and the league medians live in
// lib/boards/pitchers.ts, shared with the route that pages this board.

/**
 * Columns on the 100-centred plus scale, declared rather than pattern-matched.
 * A new plus column goes in this set or it does not get the plus treatment,
 * and that is visible here rather than implied.
 */
const PLUS_KEYS = new Set(["stuffPlus", "pitchingPlus", "kPlus", "preventionPlus", "controlPlus", "deceptionPlus"]);

function fmt(value: any, key: string): string {
  if (value === null || value === undefined) return "—";
  if (key === "name" || key === "team" || key === "throws" || key === "role" || key === "season" || key === "confidence") return String(value);
  if (typeof value !== "number" || isNaN(value)) return "—";
  if (key === "age") return String(Math.floor(value)); // season age (June 30), shown as whole years
  if (key === "rvPer100") return (value > 0 ? "+" : "") + value.toFixed(2);
  if (key === "war") return value.toFixed(1);
  if (key === "era" || key === "fip") return value.toFixed(2);
  if (key.endsWith("Pct")) return value.toFixed(1);
  if (PLUS_KEYS.has(key)) return Math.round(value).toString();
  if (key === "ip") return fmtIp(value);
  if (["velo", "ivb"].includes(key)) return value.toFixed(1);
  return String(value);
}

/** Season grades with a population (stuff_percentiles.json). */
const GRADE_PCT_KEYS = new Set(["stuffPlus", "pitchingPlus", "kPlus", "preventionPlus", "controlPlus"]);

/**
 * Columns that tint by their OWN season scale: the rank inside the row's
 * season population drives the ramp, not the grade scale — an IP of 58 is
 * not "bad", it is 58. Grades keep the grade scale and chips.
 */
const SCALED_KEYS = new Set([
  "ip", "era", "fip", "kPct", "bbPct", "kBbPct", "cswPct", "whiffPct", "velo", "ivb", "gbPct", "rvPer100",
  ...DISCIPLINE_COLUMNS.map((c) => c.key),
]);

/** Which row field backs each discipline rate's denominator in the tooltip. */
const DISC_DEN: Record<string, string> = {
  zonePct: "nPitchesLoc", chasePct: "nOozPitches", zSwingPct: "nZonePitches",
  zWhiffPct: "nZoneSwings", oWhiffPct: "nOozPitches", zContactPct: "nZoneSwings",
  oContactPct: "nOozPitches", swStrPct: "nPitchesLoc", calledStrikePct: "nPitchesLoc",
  firstPitchStrikePct: "nFirstPitch", putawayPct: "nTwoStrike",
};

export function PitchersTable({ meta, initial, percentiles, pctBySeason }: { meta: PitchersMeta; initial: PitchersPage; percentiles?: any; pctBySeason?: any }) {
  const [sortBy, setSortBy] = useState("stuffPlus");
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());
  const toggleTeams = (k: string) => setOpenTeams((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [colFilters, setColFilters] = useUrlFilters();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showModels, setShowModels] = useState(true);
  const [showDiscipline, setShowDiscipline] = useState(false);

  // Filters: in the URL, so Back from a profile restores them (owner 2026-10-02)
  const [filters, setFilters] = useUrlRecord<Record<string, any>>(PITCHER_FILTER_DEFAULTS);

  const { teams, seasons } = meta;

  const filterDefs = useMemo(() => [
    { key: "team", label: "Team", type: "select" as const, options: teams },
    { key: "season", label: "Season", type: "select" as const, options: seasons.map(String) },
    { key: "minIP", label: "Min IP", type: "range" as const, min: 0, max: 200, step: 10 },
    { key: "throws", label: "Throws", type: "toggle" as const, options: ["R", "L"] },
    { key: "role", label: "Role", type: "toggle" as const, options: ["SP", "RP"] },
    { key: "minVelo", label: "Min Velo", type: "range" as const, min: 0, max: 100, step: 2 },
    { key: "minKPct", label: "Min K%", type: "range" as const, min: 0, max: 50, step: 5 },
    { key: "minStuff", label: "Min Whiff+", type: "range" as const, min: 0, max: 130, step: 5 },
    { key: "minPitching", label: "Min Pitching+", type: "range" as const, min: 0, max: 130, step: 5 },
  ], [teams, seasons]);

  // Filter, search, sort, page and the league medians run on the server (lib/boards/pitchers.ts).
  const { data: res, fetching, error } = useBoardPage(
    "/api/data/board/pitchers",
    { search, filters, colFilters, sortBy, sortDir, page },
    PITCHER_DEFAULTS,
    initial,
  );
  const total = res?.total ?? 0;
  const totalPages = res?.totalPages ?? 0;
  const pageData = (res?.rows ?? []) as any[];
  // Median of every pitcher matching the filters, not just this page (see queryPitchers).
  const leagueRow: Record<string, number | null> = res?.medians ?? {};
  // Ranks follow the rows on screen, which during a fetch are the previous page's.
  const rankBase = ((res?.page ?? page) - 1) * PAGE_SIZE;
  const columns = [
    ...TRAD_COLUMNS,
    ...(showModels ? MODEL_COLUMNS : []),
    ...(showDiscipline ? DISCIPLINE_COLUMNS : []),
  ];
  // Index of the first column in each appended group, for the divider rule.
  const groupStarts = new Set<number>();
  if (showModels) groupStarts.add(TRAD_COLUMNS.length);
  if (showDiscipline) groupStarts.add(TRAD_COLUMNS.length + (showModels ? MODEL_COLUMNS.length : 0));

  function handleSort(key: string) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      // Results where low is good default to ascending; everything else descends.
      setSortDir(["era", "fip", "bbPct", "zContactPct", "oContactPct"].includes(key) ? "asc" : "desc");
    }
    setPage(1);
  }

  const tipOf = (key: string): string | undefined => {
    if (key === "stuffPlus") return STUFF_TIP;
    if (key === "pitchingPlus") return PITCHING_TIP;
    if (key === "kPlus") return K_TIP;
    if (key === "preventionPlus") return PREVENTION_TIP;
    if (key === "controlPlus") return CONTROL_TIP;
    if (key === "rvPer100") return RV100_TIP;
    return ([...MODEL_COLUMNS, ...DISCIPLINE_COLUMNS] as readonly { key: string; tip?: string }[]).find((c) => c.key === key)?.tip;
  };

  return (
    <>
      {/* Filter Bar */}
      <div className="flex items-center gap-2 flex-wrap relative z-10 animate-fade-up stagger-1">
        <input
          type="text"
          placeholder="Search pitchers..."
          aria-label="Search pitchers by name"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-[200px] px-3 py-1.5 rounded-full text-sm bg-white/[0.04] border border-border-subtle text-text-primary placeholder:text-text-dim focus:border-border-emphasis transition-all"
        />

        <FilterPanel
          filters={filterDefs}
          values={filters}
          onChange={(key, value) => { setFilters({ ...filters, [key]: value }); setPage(1); }}
          onReset={() => { setFilters(PITCHER_FILTER_DEFAULTS); setPage(1); }}
        />

        <button
          onClick={() => setShowModels(!showModels)}
          className={`px-3 py-1.5 rounded-full text-xs border transition-all ml-auto press-scale ${
            showModels ? "filter-chip-active" : "border-border-subtle text-text-secondary hover:bg-white/[0.03]"
          }`}
        >
          {showModels ? "Models ✓" : "Models"}
        </button>

        <button
          onClick={() => setShowDiscipline(!showDiscipline)}
          title="Zone%, chase, in-zone and out-of-zone whiff and contact, putaway — raw rates with descriptive season ranks; the sample-adjusted ranking waits on the MLB shrinkage re-measure"
          className={`px-3 py-1.5 rounded-full text-xs border transition-all press-scale ${
            showDiscipline ? "filter-chip-active" : "border-border-subtle text-text-secondary hover:bg-white/[0.03]"
          }`}
        >
          {showDiscipline ? "Discipline ✓" : "Discipline"}
        </button>
      </div>

      <FilterBuilder meta={meta.filters} columns={PITCHER_FILTER_COLUMNS as FilterColumn[]} active={colFilters}
                     onChange={(next) => { setColFilters(next); setPage(1); }} />

      {/* Results */}
      {error && <p role="alert" className="text-xs text-[#E84142]">Could not load this view. Change a filter or reload to retry.</p>}
      <p className="text-xs text-text-dim animate-fade-up stagger-2">
        Showing {total} pitcher-seasons · sorted by{" "}
        <span className="text-text-secondary">{columns.find((c) => c.key === sortBy)?.label || sortBy}</span>{" "}
        ({sortDir})
        {shrunkSortKey(sortBy) ? " · sample-adjusted order (raw rate printed; thin samples pulled toward the league)" : ""}
      </p>

      {/* Table */}
      <BorderBeam size="md" duration={8} colorVariant="ocean" theme="dark" strength={0.4}>
      <div className="glass-panel overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.2)] animate-fade-up stagger-3">
        {/*
          A real table, and the row is no longer the click target: the header is
          a `<button>` and the name is a `<Link>`, so the profile is reachable
          from the keyboard.

          The league-median row moves inside the table as the first `<tbody>`
          row; a sticky `<tr>` keeps it pinned inside the scroll box.
        */}
        {/* Dimmed, never blanked, while the next view loads (the last one stays up). */}
        <div className={`max-h-[calc(100vh-280px)] overflow-auto transition-opacity ${fetching ? "opacity-60" : ""}`} aria-busy={fetching}>
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              {total} pitcher-seasons, sorted by{" "}
              {columns.find((c) => c.key === sortBy)?.label ?? sortBy} {sortDir === "desc" ? "descending" : "ascending"}.
              Page {page} of {totalPages}.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-surface-1 w-[32px] border-b border-border-subtle px-0 py-2.5 text-center text-[10px] font-medium text-text-dim"
                >
                  #<span className="sr-only"> rank on this page</span>
                </th>
                {columns.map((col, ci) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      sortBy === col.key ? (sortDir === "desc" ? "descending" : "ascending") : "none"
                    }
                    className={`${col.w} sticky top-0 z-10 bg-surface-1 border-b border-border-subtle p-0 ${
                      groupStarts.has(ci) ? "border-l border-border-subtle" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      title={tipOf(col.key)}
                      className={`w-full px-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${sortBy === col.key ? "text-usf-gold" : "text-text-dim hover:text-text-secondary"} ${
                        groupStarts.has(ci) ? "pl-2" : ""
                      }`}
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
              {showModels && (
                <tr className="bg-white/[0.02]" style={{ height: "30px" }}>
                  <td className="w-[32px] border-b border-border-subtle text-center text-[11px] text-text-dim font-data">
                    —
                  </td>
                  {columns.map((col, ci) => {
                    const median = leagueRow[col.key];
                    const isBorder = groupStarts.has(ci);
                    const Tag = col.key === "name" ? "th" : "td";
                    return (
                      <Tag
                        key={col.key}
                        {...(col.key === "name" ? { scope: "row" as const } : {})}
                        className={`${col.w} border-b border-border-subtle px-1 text-[11px] font-normal truncate text-text-dim ${
                          col.align === "right" ? "text-right font-data" : "text-left"
                        } ${isBorder ? "border-l border-border-subtle pl-2" : ""}`}
                        title={
                          median === null
                            ? undefined
                            : `Median of the ${total} pitcher-seasons matching the current filters`
                        }
                      >
                        {col.key === "name"
                          ? "league median"
                          : median === null || median === undefined
                            ? ""
                            : fmt(median, col.key)}
                      </Tag>
                    );
                  })}
                </tr>
              )}

              {pageData.map((row, i) => (
                <Fragment key={`${row.id}-${row.season}`}>
                <tr
                  key={`${row.id}-${row.season}`}
                  className={`border-b border-white/[0.025] hover:bg-white/[0.04] transition-colors ${
                    i % 2 === 1 ? "bg-white/[0.012]" : ""
                  }`}
                  style={{ height: "36px" }}
                >
                  <td className="w-[32px] border-b border-white/[0.025] text-center text-[11px] text-text-dim font-data">
                    {rankBase + i + 1}
                  </td>
              {columns.map((col, ci) => {
                const raw = (row as any)[col.key];
                const value = fmt(raw, col.key);
                const isName = col.key === "name";
                const isHighlighted = col.key === sortBy && !isName && col.key !== "team";
                const bp = pctBySeason?.[String(row.season)]?.[col.key];
                const color = PLUS_KEYS.has(col.key) || GRADE_PCT_KEYS.has(col.key)
                  ? gradeColor(raw)
                  : SCALED_KEYS.has(col.key) && !isNeutralStat("pitcher", col.key) && typeof raw === "number" && bp
                    ? percentileColor(getPitcherPercentileRank(col.key, raw, bp))
                    : undefined;
                const isBorder = groupStarts.has(ci);
                // Discipline tooltips stand on a denominator — say which.
                const denKey = DISC_DEN[col.key];
                const den = denKey ? (row as any)[denKey] : undefined;
                const baseTip = isName ? undefined : tipOf(col.key);
                const tooltip = baseTip && den !== undefined && den !== null ? `${baseTip} (${den} events)` : baseTip;

                const Tag = isName ? "th" : "td";
                return (
                  <Tag
                    key={col.key}
                    {...(isName ? { scope: "row" as const } : {})}
                    className={`${col.w} border-b border-white/[0.025] px-1 text-xs font-normal truncate ${
                      col.align === "right" ? "text-right font-data" : "text-left"
                    } ${isName ? "text-text-primary font-medium" : "text-text-secondary"} ${
                      isHighlighted ? "text-usf-gold" : ""
                    } ${isBorder ? "border-l border-border-subtle pl-2" : ""}`}
                    style={color ? { color } : undefined}
                    title={isName ? value : tooltip}
                  >
                    {isName ? (
                      <PlayerLink href={`/player/${row.id}?season=${row.season}`} info={{ name: row.name, team: row.team, teamName: row.team, pos: "Pitcher" }} className="hover:underline">
                        <PixelTeamLogo team={row.team} size={16} className="mr-1.5" />
                        {value}
                      </PlayerLink>
                    ) : col.key === "team" && multiTeam(row) ? (
                      <TeamCountButton row={row} open={openTeams.has(`${row.id}-${row.season}`)} onToggle={() => toggleTeams(`${row.id}-${row.season}`)} />
                    ) : col.key === "war" && typeof raw === "number" ? <Signed v={raw} dp={1} /> : value}
                    {GRADE_PCT_KEYS.has(col.key) && <GradePct metric={col.key} value={raw} n={gradedN(row)} season={row.season} />}
                    {isName && (row as any).confidence && (() => {
                      const tier = (row as any).confidence;
                      const tColors: Record<string, string> = {
                        HIGH: "bg-emerald-500/20 text-emerald-400",
                        MODERATE: "bg-teal-500/20 text-teal-400",
                        LOW: "bg-amber-500/20 text-amber-400",
                        MINIMAL: "bg-gray-500/20 text-gray-400",
                      };
                      const tLabels: Record<string, string> = {
                        HIGH: "H", MODERATE: "M", LOW: "L", MINIMAL: "–",
                      };
                      return (
                        <span className={`ml-1 px-1 py-0.5 rounded text-[10px] font-bold ${tColors[tier] || tColors.MINIMAL}`}>
                          {tLabels[tier] || "?"}
                        </span>
                      );
                    })()}
                  </Tag>
                );
              })}
                </tr>
                {openTeams.has(`${row.id}-${row.season}`) && <TeamSplitRows row={row} columns={columns} fmt={fmt} />}
                </Fragment>
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
      </BorderBeam>
    </>
  );
}
