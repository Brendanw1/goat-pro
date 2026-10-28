"use client";

/**
 * /arsenal?view=slot: pick a pitch type, read the pitchers who throw it grouped
 * by arm slot. Release columns come from slot_board.json (A3), grades from the
 * arsenal rows (A4), joined in lib/boards/slot.ts. The mound graphic, the
 * slot-expected shape deltas and the xRV column are not in the MVP bake and
 * are deleted here, not stubbed.
 */
import { useState } from "react";
import Link from "next/link";
import { FilterPanel } from "@/components/filter-panel";
import { FilterBuilder, useUrlFilters } from "@/components/ui/filter-builder";
import { GradePct, gradedN } from "@/components/ui/grade-pct";
import { DescriptiveChip, gradeColor } from "@/lib/grades";
import { toneColor } from "@/components/ui/shared-ui";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { PITCH_CONFIG } from "@/lib/constants";
import { SLOT_BANDS } from "@/lib/arm-slot";
import { useBoardPage } from "@/lib/boards/use-board-page";
import { GyroTag } from "@/components/ui/shared-grade-note";
import { PAGE_SIZE } from "@/lib/boards/shared";
import { useUrlRecord } from "@/lib/use-url-record";
import {
  ARM_MAX, ARM_MIN, SLOT_COLS, SLOT_DEFAULTS, SLOT_FILTER_COLUMNS, SLOT_FILTER_DEFAULTS, SLOT_PITCH_TYPES,
  type SlotMeta, type SlotPage,
} from "@/lib/boards/slot";
import type { PitchType } from "@/types";

const ONE_DP = new Set(["relH", "relS", "ext", "fbVelo", "usage", "velo", "ivb", "hb", "whiffVsSlot", "whiffVsSlotAll"]);
const SIGNED = new Set(["whiffVsSlot", "whiffVsSlotAll"]);

function fmt(value: any, key: string): string {
  if (value === null || value === undefined) return "—";
  if (key === "name" || key === "team" || key === "throws" || key === "band" || key === "fb") return String(value);
  if (key === "season") return String(Math.round(value));
  if (typeof value !== "number" || isNaN(value)) return "—";
  if (SIGNED.has(key)) return (value > 0 ? "+" : "") + value.toFixed(1);
  if (key.endsWith("Pct") || key === "usage") return value.toFixed(1);
  if (["stuffPlus", "pitchingPlus", "arm", "n_pitches"].includes(key)) return Math.round(value).toString();
  if (ONE_DP.has(key)) return value.toFixed(1);
  return String(value);
}

export function SlotBoard({ meta, initial }: { meta: SlotMeta; initial: SlotPage }) {
  const [sortBy, setSortBy] = useState("stuffPlus");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [colFilters, setColFilters] = useUrlFilters();
  // The pitch type rides the URL-style filter record with the rest.
  const [filters, setFilters] = useUrlRecord<Record<string, any>>(SLOT_FILTER_DEFAULTS);
  const pt = String(filters.pt ?? "FF");
  const config = PITCH_CONFIG[pt as PitchType] || PITCH_CONFIG.FF;
  const [showArmRange, setShowArmRange] = useState(false);

  const { data: res, fetching, error } = useBoardPage(
    "/api/data/board/slot",
    { search: "", filters, colFilters, sortBy, sortDir, page },
    SLOT_DEFAULTS,
    initial,
  );
  const total = res?.total ?? 0;
  const totalPages = res?.totalPages ?? 0;
  const pageData = (res?.rows ?? []) as any[];
  const bandCounts = (res as any)?.bandCounts ?? {};
  const rankBase = ((res?.page ?? page) - 1) * PAGE_SIZE;

  function handleSort(key: string) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(key); setSortDir("desc"); }
    setPage(1);
  }

  const lo = Math.min(Number(filters.armMin ?? ARM_MIN), Number(filters.armMax ?? ARM_MAX));
  const hi = Math.max(Number(filters.armMin ?? ARM_MIN), Number(filters.armMax ?? ARM_MAX));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim">
          Release columns from Hawk-Eye; grades are descriptive, not forecasts.
          {meta.season ? ` · ${meta.season} season` : ""}
        </span>
      </div>

      {/* Pitch type picker */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Pitch type">
        {SLOT_PITCH_TYPES.map((code) => {
          const cfg = PITCH_CONFIG[code as PitchType] || PITCH_CONFIG.FF;
          const on = code === pt;
          return (
            <button key={code} type="button" aria-pressed={on}
              onClick={() => { setFilters({ ...filters, pt: code }); setPage(1); }}
              className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors ${on ? "border-white/[0.15] bg-white/[0.08] text-text-primary" : "border-border-subtle text-text-dim hover:bg-white/[0.05]"}`}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: cfg.color }} />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Arm-band chips with counts */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Arm slot band">
        <button type="button" aria-pressed={!filters.band}
          onClick={() => { setFilters({ ...filters, band: "" }); setPage(1); }}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${!filters.band ? "filter-chip-active" : "border-border-subtle text-text-dim hover:bg-white/[0.05]"}`}>
          All bands
        </button>
        {SLOT_BANDS.map((b) => (
          <button key={b.key} type="button" aria-pressed={filters.band === b.key}
            onClick={() => { setFilters({ ...filters, band: b.key }); setPage(1); }}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${filters.band === b.key ? "filter-chip-active" : "border-border-subtle text-text-dim hover:bg-white/[0.05]"}`}>
            {b.short} <span className="font-data text-[9px] opacity-70">{bandCounts[b.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap relative z-10">
        <FilterPanel
          filters={[
            { key: "team", label: "Team", type: "select" as const, options: meta.teams },
            { key: "season", label: "Season", type: "select" as const, options: (meta.seasons ?? []).map(String) },
            { key: "throws", label: "Throws", type: "toggle" as const, options: ["R", "L"] },
            { key: "minPitches", label: "Min Pitches", type: "range" as const, min: 0, max: 200, step: 10 },
            { key: "minUsage", label: "Min Usage%", type: "range" as const, min: 0, max: 50, step: 5 },
            { key: "minVelo", label: "Min Velo", type: "range" as const, min: 0, max: 100, step: 1 },
          ]}
          values={filters}
          onChange={(key, value) => { setFilters({ ...filters, [key]: value }); setPage(1); }}
          onReset={() => { setFilters(SLOT_FILTER_DEFAULTS); setPage(1); }}
        />
        <button
          onClick={() => setShowArmRange((v) => !v)}
          className={`ml-auto press-scale rounded-full border px-3 py-1.5 text-xs transition-all ${
            showArmRange ? "filter-chip-active" : "border-border-subtle text-text-secondary hover:bg-white/[0.03]"
          }`}
        >
          {showArmRange ? "Arm angle range ✓" : "Arm angle range"}
        </button>
      </div>

      {showArmRange && (
        <div className="glass-panel p-3 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
          <label className="flex items-center gap-2">
            From
            <input type="number" min={ARM_MIN} max={ARM_MAX} value={filters.armMin ?? ARM_MIN}
              onChange={(e) => { setFilters({ ...filters, armMin: Number(e.target.value) }); setPage(1); }}
              className="w-16 px-2 py-1 rounded bg-white/[0.04] border border-border-subtle font-data" />°
          </label>
          <label className="flex items-center gap-2">
            To
            <input type="number" min={ARM_MIN} max={ARM_MAX} value={filters.armMax ?? ARM_MAX}
              onChange={(e) => { setFilters({ ...filters, armMax: Number(e.target.value) }); setPage(1); }}
              className="w-16 px-2 py-1 rounded bg-white/[0.04] border border-border-subtle font-data" />°
          </label>
          <span className="text-[10px] text-text-dim">0 sidearm · 90 over the top (currently {lo}–{hi}°)</span>
        </div>
      )}

      <FilterBuilder meta={meta.filters} columns={SLOT_FILTER_COLUMNS} active={colFilters}
                     onChange={(next) => { setColFilters(next); setPage(1); }} />

      {error && <p role="alert" className="text-xs text-[#E84142]">Could not load this view. Change a filter or reload to retry.</p>}

      <div className="glass-panel overflow-hidden">
        <div className={`overflow-x-auto transition-opacity ${fetching ? "opacity-60" : ""}`} aria-busy={fetching}>
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              {config.label} arm-slot leaderboard, sorted by {SLOT_COLS.find((c) => c.key === sortBy)?.label ?? sortBy}{" "}
              {sortDir === "desc" ? "descending" : "ascending"}. Page {page} of {totalPages}.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="w-[36px] border-b border-border-subtle px-0 py-2.5 text-center text-[10px] font-medium text-text-dim">
                  #<span className="sr-only"> rank on this page</span>
                </th>
                {SLOT_COLS.map((col) => (
                  <th key={col.key} scope="col"
                    aria-sort={sortBy === col.key ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
                    className={`${col.w} border-b border-border-subtle p-0`}>
                    <button type="button" onClick={() => handleSort(col.key)} title={"tip" in col ? (col as any).tip : undefined}
                      className={`w-full px-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${sortBy === col.key ? "text-usf-gold" : "text-text-dim hover:text-text-secondary"}`}>
                      {col.label}
                      {sortBy === col.key && <span className="ml-0.5 text-[10px]" aria-hidden="true">{sortDir === "desc" ? "▼" : "▲"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((row, i) => (
                // id+season+position: the same player appears once per season
                <tr key={`${row.id}-${row.season}-${i}`}
                  className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${i % 2 === 1 ? "bg-white/[0.015]" : ""}`}
                  style={{ height: "36px" }}>
                  <td className="w-[36px] border-b border-white/[0.03] text-center text-[11px] text-text-dim font-data">
                    {rankBase + i + 1}
                  </td>
                  {SLOT_COLS.map((col) => {
                    const raw = row[col.key];
                    const value = fmt(raw, col.key);
                    const isName = col.key === "name";
                    const isModel = "model" in col && col.model;
                    const color = isModel && col.key.endsWith("SlotPct") === false ? gradeColor(raw)
                      : SIGNED.has(col.key) ? toneColor(raw) : undefined;
                    return (
                      <td key={col.key}
                        className={`${col.w} border-b border-white/[0.03] px-1.5 text-xs font-normal truncate ${
                          col.align === "right" ? "text-right font-data" : "text-left"
                        } ${isName ? "text-text-primary font-medium" : "text-text-secondary"}`}
                        style={color ? { color } : undefined}
                        title={isName ? value
                          : col.key === "whiffVsSlot" && typeof row.whiffSlotPeer === "number"
                            ? `${row.whiffPct ?? "—"}% whiff on ${row.nSwings ?? 0} swings vs ${row.whiffSlotPeer}% for ${row.band} ${pt}s; sample-adjusted order`
                            : col.key === "whiffVsSlotAll" && typeof row.whiffSlotPeerAll === "number"
                              ? `${row.whiffAll ?? "—"}% whiff overall vs ${row.whiffSlotPeerAll}% for his band; sample-adjusted`
                              : undefined}>
                        {isName ? (
                          <Link href={`/player/${row.id}?season=${row.season}`} className="hover:underline">
                            <PixelTeamLogo team={row.team} size={16} className="mr-1.5" />
                            {value}
                            {row.gyro ? <span className="ml-1.5"><GyroTag /></span> : null}
                          </Link>
                        ) : col.key.endsWith("SlotPct") && typeof raw === "number" ? (
                          <GradePct metric={col.key.replace("SlotPct", "")} value={row[col.key.replace("SlotPct", "")]} n={gradedN(row)} code={pt} season={row.season} className="" />
                        ) : value}
                      </td>
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
    </div>
  );
}
