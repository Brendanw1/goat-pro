"use client";

/**
 * Timing residual, hitter side (RESULTS-MLB §92; bake pipeline/timing_residual.py). Lives in the Swing tab.
 * Contact depth minus the depth the pitch (speed, type, movement, location), the count and his own season mean
 * from his other games predict. + = early (met further out front), − = late. Contact swings only.
 * Biases are shrunk toward 0 by sample; each shown trait passed split-half reliability (Spearman-Brown ≥ .60).
 * Timing is a style, not good or bad, so nothing is coloured. Consistency (residual SD) does not forecast (§92 gate b).
 */
import { useEffect, useState } from "react";
import { ordinal } from "@/lib/percentiles";

const LABEL: Record<string, string> = { FB: "Fastballs", BR: "Breaking", OS: "Offspeed", "92-95": "FB 92–95", "95+": "FB 95+" };
const ACCENT = "#8b93a7";

export function TimingPanel({ id, season }: { id: number | string; season: number | string }) {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/timing/${id}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((j) => live && setD(j)).catch(() => {});
    return () => { live = false; };
  }, [id, season]);
  if (!d?.row) return null;
  const { row, meta } = d;
  const bars = (meta.shown as string[]).map((k) => ({ k, b: row.bias?.[k] })).filter((x) => x.b && x.b.n >= (meta.floors?.[x.k] ?? 25));
  if (!bars.length) return null;
  const lim = Math.max(1.5, ...bars.map((x) => Math.abs(x.b.s))) * 1.15;
  const W = 640, ROW = 24, PL = 80, PR = 120, H = bars.length * ROW + 24;
  const px = (v: number) => PL + ((v + lim) / (2 * lim)) * (W - PL - PR);
  const title = row.tags?.length
    ? `He is ${row.tags.length > 1 ? `${row.tags.slice(0, -1).join(", ")} and ${row.tags[row.tags.length - 1]}` : row.tags[0]}`
    : "No timing lean beyond the league's middle 60% on any pitch group";
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}"`;

  return (
    <figure className="glass-panel p-3">
      <figcaption className="mb-1.5">
        <div className="text-[13px] font-semibold text-text-primary leading-snug">{title}</div>
        <div className="text-[10px] text-text-dim">
          {row.n.toLocaleString()} contacts on competitive swings · {season} · bars = shrunk timing bias (in.), n per row
        </div>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Timing bias by pitch group">
        <line x1={px(0)} x2={px(0)} y1={4} y2={H - 18} stroke="rgba(255,255,255,0.25)" />
        {bars.map(({ k, b }, i) => {
          const y = 8 + i * ROW, x0 = px(Math.min(0, b.s)), x1 = px(Math.max(0, b.s));
          return (
            <g key={k}>
              <text x={PL - 8} y={y + 12} textAnchor="end" className="fill-current text-text-secondary" fontSize="10">{LABEL[k] ?? k}</text>
              <rect x={x0} y={y + 2} width={Math.max(1, x1 - x0)} height={14} rx={2} fill={ACCENT} opacity={0.75} />
              <text x={W - PR + 6} y={y + 12} className="fill-current text-text-dim" fontSize="10" fontFamily="var(--font-data, monospace)">
                {fmt(b.s)} · n {b.n}
              </text>
            </g>
          );
        })}
        <text x={px(-lim)} y={H - 4} fontSize="9" className="fill-current text-text-dim">← late (deep)</text>
        <text x={px(lim)} y={H - 4} fontSize="9" textAnchor="end" className="fill-current text-text-dim">early (out front) →</text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <span>
          Timing spread <span className="font-data text-text-primary">{row.sd.toFixed(1)}"</span>{" "}
          <span className="text-[9px] text-text-dim">{ordinal(row.sdPct)} percentile (high = wider)</span>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-text-secondary leading-snug">
        Each contact&apos;s depth minus the depth its pitch, the count and his own mean from his other games predict. A bias is
        his lean on that pitch group relative to his own average, shrunk by sample. Split halves of the season agree at
        Spearman-Brown {meta.reliability?.FB?.toFixed(2)} (fastballs) to {meta.reliability?.["92-95"]?.toFixed(2)} (92–95); sub-92
        fastballs failed and are not shown. The spread is a stable trait but does not forecast next season&apos;s K% or xwOBAcon
        (§92). Descriptive, not a forecast.
      </p>
    </figure>
  );
}
