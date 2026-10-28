"use client";

/**
 * The one percentile display on a player profile (design review 2026-10-23, option A).
 *
 * A Savant-style row: label | track with a p50 tick and a circle at the rank holding the rank number | the raw
 * value outside the track. Every percentile on the profile goes through `PercentileRow` (or `PercentileDot`, its
 * mini form for the header), so a rank looks the same wherever it appears and comes from one scope.
 *
 * Three states besides a plain rank, each drawn so it cannot be mistaken for a confident one:
 *   - neutral    — a descriptive stat (isNeutralStat): grey circle, the rank, no verdict colour.
 *   - provisional — a shrunk discipline rate resting mostly on the league: hollow ring, "~" before the rank.
 *   - small      — below the floor but drawable (n >= FADE_MIN_N, `floor` set): ranked off the raw value, hollow dashed
 *                  ring, hatched faded bar with a dashed edge (the coach cards' faded rule), "7 of 15 pitches" under it.
 *   - thin       — below the sample floor: no circle at all, the track dashed, "n=58" where the rank would be.
 */

import type { ReactNode } from "react";
import {
  NEUTRAL_GREY,
  getPitcherPercentileRank,
  getStatPercentileRank,
  isNeutralStat,
  percentileColor,
} from "@/lib/percentiles";

/** Alpha of a drawn-below-floor bar (was lib/game-plan FADE_ALPHA). */
const FADE_ALPHA = 0.45;

export interface PctRow {
  key: string;
  label: string;
  /** The raw value, formatted. Always printed, ranked or not. */
  display: string;
  /** 1-99, or null when it cannot be ranked (no breakpoints, or below the floor). */
  rank: number | null;
  neutral?: boolean;
  provisional?: boolean;
  /** Sample behind the row, shown in place of the rank when it is below the floor. */
  n?: number | null;
  /** What `n` counts ("BF", "PA", "pitches"); omitted for discipline rows, whose title says. */
  nUnit?: string;
  title?: string;
  /** Set on a ranked row below its floor: the small-sample state, "n of floor". */
  floor?: number;
  /** A small second line under the label (VAA by zone: the row's direction verdict). Grey when `neutral`. */
  note?: string;
}

/** Text on a ramp-coloured circle: dark on the light end of the ramp, light on the dark end. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.18 ? "#0b0f0e" : "#f3f5f6";
}

export function PercentileRow({ row }: { row: PctRow }) {
  const { label, display, rank, neutral, provisional, n, nUnit, title, note, floor } = row;
  const ranked = rank !== null;
  const small = ranked && floor !== undefined && typeof n === "number";
  const color = !ranked ? NEUTRAL_GREY : neutral ? NEUTRAL_GREY : percentileColor(rank);
  return (
    <div className="flex items-center gap-3 py-[5px]" title={title} data-pct-row={row.key}>
      {note || small ? (
        <span className="flex w-[92px] shrink-0 flex-col leading-tight">
          <span className="truncate text-[11px] text-text-secondary">{label}</span>
          {note && <span className={`truncate text-[9px] ${neutral ? "text-text-dim" : "text-text-secondary"}`} data-note="">{note}</span>}
          {small && (
            <span className="truncate text-[9px] text-amber-200/80" data-small="">
              {n} of {floor}{nUnit ? ` ${nUnit}` : ""}
            </span>
          )}
        </span>
      ) : (
        <span className="w-[92px] shrink-0 truncate text-[11px] text-text-secondary">{label}</span>
      )}
      {/* The track. Padded by the circle's radius so a 1st or 99th sits inside it. */}
      <div className="relative h-[22px] flex-1 px-[11px]">
        <div
          aria-hidden="true"
          className={`absolute inset-x-[11px] top-1/2 h-[4px] -translate-y-1/2 rounded-full ${
            ranked ? "bg-white/[0.07]" : "border-t border-dashed border-white/[0.18] bg-transparent"
          }`}
        />
        {/* p50 tick: the scope's median, wherever the scope toggle points. */}
        <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[10px] w-px -translate-y-1/2 bg-white/30" />
        {ranked ? (
          <div className="absolute inset-x-[11px] inset-y-0">
            {small ? (
              // Faded rule (#157): colour at FADE_ALPHA, hatched, dashed edge.
              <div
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-[6px] -translate-y-1/2 rounded-sm border border-dashed"
                style={{
                  width: `${rank}%`,
                  borderColor: color,
                  opacity: FADE_ALPHA + 0.25,
                  backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 4px)`,
                }}
                data-small-bar=""
              />
            ) : !provisional && (
              <div
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full opacity-45"
                style={{ width: `${rank}%`, backgroundColor: color }}
              />
            )}
            <span
              className="absolute top-1/2 flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-data text-[10px] font-bold tabular-nums"
              style={
                small
                  ? { left: `${rank}%`, border: `2px dashed ${color}`, color, background: "#0a0e0d" }
                  : provisional
                  ? { left: `${rank}%`, border: `2px solid ${color}`, color, background: "#0a0e0d" }
                  : { left: `${rank}%`, backgroundColor: color, color: inkOn(color) }
              }
              data-rank={rank}
              data-neutral={neutral ? "" : undefined}
              data-provisional={provisional ? "" : undefined}
              data-small={small ? "" : undefined}
            >
              {provisional && <span aria-hidden="true">~</span>}
              {rank}
              <span className="sr-only">
                th percentile{provisional ? ", provisional: mostly the league average" : ""}
                {small ? `, small sample: ${n} of ${floor}` : ""}
                {neutral ? ", descriptive, no good or bad direction" : ""}
              </span>
            </span>
          </div>
        ) : (
          <span
            className="absolute left-[11px] top-1/2 -translate-y-1/2 rounded bg-[#0a0e0d] pr-1.5 font-data text-[10px] text-text-dim"
            data-thin=""
          >
            {typeof n === "number" ? `n=${n.toLocaleString()}${nUnit ? ` ${nUnit}` : ""}` : "—"}
            <span className="sr-only"> — too few to rank</span>
          </span>
        )}
      </div>
      <span className="w-[56px] shrink-0 text-right font-data text-xs font-semibold text-text-primary tabular-nums">
        {display}
      </span>
    </div>
  );
}

/** The header's mini form: a dot in the rank's colour and the rank. Same colour rules as the row. */
export function PercentileDot({ rank, neutral, title }: { rank: number | null; neutral?: boolean; title?: string }) {
  if (rank === null) return null;
  const color = neutral ? NEUTRAL_GREY : percentileColor(rank);
  return (
    <span className="inline-flex items-center gap-1 font-data text-[10px] text-text-secondary" title={title}>
      <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: color }} />
      {rank}
      <span className="sr-only">th percentile</span>
    </span>
  );
}

/** One skill group: a heading and its rows. Renders nothing when no row has a value. */
export function PercentileGroup({ title, rows, aside }: { title: ReactNode; rows: (PctRow | null)[]; aside?: ReactNode }) {
  const kept = rows.filter((r): r is PctRow => r !== null);
  if (kept.length === 0) return null;
  return (
    <section className="break-inside-avoid pb-4">
      <h3 className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-text-primary">
        <span className="flex items-center gap-1.5">{title}</span>
        {aside}
      </h3>
      {kept.map((r) => (
        <PercentileRow key={r.key} row={r} />
      ))}
    </section>
  );
}

/**
 * Build a row for a profile stat. `thin` is the sample when the player is under the profile floor — pass
 * `{ n, unit, floor }` and the rank is STILL COMPUTED and drawn in the hollow small-sample state (dashed ring,
 * hatched bar, "n of floor" under the label): the percentile is there to compare with, but visibly not filled in
 * until the sample reaches `floor`. A bare number suppresses the rank entirely (a row that must not rank at all).
 */
export function statRow(
  role: "hitter" | "pitcher",
  key: string,
  label: string,
  value: unknown,
  fmt: (v: number) => string,
  breakpoints: any,
  thin: number | { n: number; unit?: string; floor?: number } | null = null,
  rankKey: string = key,
  /** Print a different number than the one ranked: the discipline panels rank
   * the sample-adjusted twin and print the raw rate. */
  displayOverride?: string,
): PctRow | null {
  const thinObj = thin !== null && typeof thin === "object" ? thin : null;
  const thinN = thin === null ? null : typeof thin === "number" ? thin : thin.n;
  const nUnit = thinObj?.unit;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // No population for this stat in this scope: no row, rather than a row that looks thin.
  if (!breakpoints) return null;
  const rank =
    role === "hitter"
      ? getStatPercentileRank(rankKey, value, breakpoints)
      : getPitcherPercentileRank(rankKey, value, breakpoints);
  return {
    key, label, display: displayOverride ?? fmt(value), rank, n: thinN, nUnit,
    neutral: isNeutralStat(role, rankKey),
    floor: thinObj?.floor,
  };
}

/**
 * The profile's one percentile panel: heading, the peer group and sample it ranks against, the scope toggle that
 * drives every percentile on the page, an optional thin-sample banner, then the skill groups flowed into balanced
 * columns. Groups with no rows render nothing, so an empty block never shows.
 */
export function PercentilePanel({
  peer,
  toggle,
  banner,
  footer,
  children,
}: {
  /** e.g. "vs Sun Belt pitchers · 2026 · 108.3 IP · 1,709 pitches" */
  peer: ReactNode;
  toggle: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-panel p-4 shadow-[0_6px_24px_rgba(0,0,0,0.3)]" aria-label="Percentile rankings">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">Percentile rankings</h2>
          <p className="mt-0.5 text-[11px] text-text-secondary" data-peer-label="">{peer}</p>
        </div>
        <div className="w-full sm:w-[260px]">{toggle}</div>
      </div>
      {banner}
      <div className="columns-1 gap-8 lg:columns-2">{children}</div>
      {footer}
    </section>
  );
}

/** Amber strip naming the sample when the player is under the profile floor. */
export function ThinSampleBanner({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-200">
      {children}
    </div>
  );
}

/**
 * One headline number: the value, its label, and the mini percentile under it. Every number in both profile
 * headers uses this, so the header has one treatment (value white, rank as a dot line) instead of three.
 */
export function HeaderStat({ label, value, rank, neutral, title, sub }: {
  label: string; value: string; rank?: number | null; neutral?: boolean; title?: string; sub?: ReactNode;
}) {
  return (
    <div className="min-w-[44px] text-center" title={title}>
      <div className="font-data text-lg font-bold leading-tight text-text-primary">{value}</div>
      <div className="text-[10px] text-text-dim">{label}</div>
      <div className="flex h-[14px] items-center justify-center">
        {rank != null ? <PercentileDot rank={rank} neutral={neutral} /> : sub}
      </div>
    </div>
  );
}
