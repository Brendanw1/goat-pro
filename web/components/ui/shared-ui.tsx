/**
 * Shared display bits. `PctChip`/`luminance` were rescued from the fork's
 * defense folder (which shipped team-defense pages this MVP does not); `Signed`
 * and `signedFixed` likewise from its signed-stat helper.
 */
import type { ReactNode } from "react";
import { NEUTRAL_GREY, percentileColor } from "@/lib/percentiles";

/** Relative luminance of a hex colour, 0–1. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** A percentile as a filled chip (colour = the site ramp, dark or light text for contrast). `children` overrides the label. */
/** `neutral`: rank shown in grey, for stats with no good/bad direction. */
export function PctChip({ p, title, children, neutral }: { p: number; title?: string; children?: ReactNode; neutral?: boolean }) {
  const bg = neutral ? NEUTRAL_GREY : percentileColor(p);
  return (
    <span data-pct={Math.round(p)} title={title ?? `${Math.round(p)}th percentile`}
      className="inline-flex min-w-[1.9rem] justify-center rounded-md px-1 py-[1px] font-data text-[10px] font-semibold leading-4 tabular-nums"
      style={{ backgroundColor: bg, color: luminance(bg) > 0.4 ? "#10141b" : "#ffffff" }}>
      {children ?? Math.round(p)}
    </span>
  );
}

export const GOOD = percentileColor(95), BAD = percentileColor(5);

/** A signed stat, coloured by what it means for the player: green when good for him, red when bad, nothing at zero. */
export function toneColor(v: number | null | undefined, lowerIsGood = false, dp = 2): string | undefined {
  if (v == null || !Number.isFinite(v) || Number(v.toFixed(dp)) === 0) return undefined;
  return (v > 0) !== lowerIsGood ? GOOD : BAD;
}

/** "+1.2" / "−0.5"; a value that ROUNDS to zero prints "0.0" with no sign (−0.0 reads as "slightly bad"). */
export function signedFixed(x: number | null | undefined, dp: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const r = Number(x.toFixed(dp));
  if (r === 0) return (0).toFixed(dp);
  return (r > 0 ? "+" : "−") + Math.abs(r).toFixed(dp);
}

export function Signed({ v, dp, lowerIsGood = false, className = "font-data" }: { v: number | null | undefined; dp: number; lowerIsGood?: boolean; className?: string }) {
  return <span className={className} style={{ color: toneColor(v, lowerIsGood, dp) }}>{signedFixed(v, dp)}</span>;
}

export type TeamStint = { team: string; from: string; to: string; g: number };

const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "DET → LAD (Aug 3)" for a player who changed teams (date = his first game for the latest club); else the team. */
export function TeamLine({ team, teams }: { team?: string | null; teams?: TeamStint[] | null }) {
  if (!teams || teams.length < 2) return <>{team ?? "—"}</>;
  const last = teams[teams.length - 1];
  return (
    <span title={teams.map((t) => `${t.team}: ${t.g} G, ${md(t.from)}–${md(t.to)}`).join(" · ")}>
      {teams.map((t) => t.team).join(" → ")} ({md(last.from)})
    </span>
  );
}

/** Expandable per-club lines under a profile header, for a player who changed teams. */
export function TeamSplitsDetails({ lines, cols }: { lines?: any[] | null; cols: [key: string, label: string, digits: number][] }) {
  if (!lines || lines.length < 2) return null;
  const cell = (v: unknown, d: number) => (typeof v === "number" ? (d === 3 ? v.toFixed(3).replace(/^0/, "") : v.toFixed(d)) : "—");
  return (
    <details className="mt-1 text-[11px] text-text-dim">
      <summary className="cursor-pointer select-none hover:text-text-secondary">Per-club lines</summary>
      <table className="mt-1 font-data">
        <thead><tr><th className="pr-3 text-left font-normal">Club</th><th className="pr-3 text-right font-normal">G</th>
          {cols.map(([k, l]) => <th key={k} className="pr-3 text-right font-normal">{l}</th>)}</tr></thead>
        <tbody>{lines.map((ln) => (
          <tr key={ln.team}><td className="pr-3">{ln.team}</td><td className="pr-3 text-right">{ln.g}</td>
            {cols.map(([k, , d]) => <td key={k} className="pr-3 text-right text-text-secondary">{cell(ln[k], d)}</td>)}</tr>
        ))}</tbody>
      </table>
      <p className="mt-0.5">Each club&rsquo;s own line. Pitchers: ERA and IP are the official per-club lines; Whiff+ is graded on that club&rsquo;s pitches on the season scale. K+, Prevention+ and the other projections cover the whole season.</p>
    </details>
  );
}
