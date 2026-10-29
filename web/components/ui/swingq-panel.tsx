"use client";

/**
 * Swing Quality (RESULTS-MLB §98; bake pipeline/swing_quality.py). Lives in the Swing tab.
 * The grade is the xwOBA on contact his swings should produce (bat tracking + pitch + contact point, a hitter-grouped
 * cross-fit model that never saw him), on a 100 scale (league = 100, 10 = one SD of qualified hitters). Bars split the
 * grade into bat speed, swing plane, contact point, pitch diet and context (grouped TreeSHAP). The gap is results minus
 * the swing: green when his results run ahead of it. meta.verdict says whether it is a forecast; default descriptive.
 */
import { useEffect, useState } from "react";
import { ordinal } from "@/lib/percentiles";
import { Signed, signedFixed, toneColor } from "@/components/ui/shared-ui";

const LABEL: Record<string, string> = {
  batSpeed: "Bat speed", plane: "Swing plane", contactPoint: "Contact point", pitchDiet: "Pitch diet", context: "Count & hand",
};

export function SwingQPanel({ id, season }: { id: number | string; season: number | string }) {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/swingq/${id}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((j) => live && setD(j)).catch(() => {});
    return () => { live = false; };
  }, [id, season]);
  if (!d?.row) return null;
  const { row, meta } = d;
  const keys = Object.keys(LABEL).filter((k) => row.parts?.[k] != null);
  const lim = Math.max(4, ...keys.map((k) => Math.abs(row.parts[k]))) * 1.15;
  const W = 640, ROW = 22, PL = 110, PR = 70, H = keys.length * ROW + 22;
  const px = (v: number) => PL + ((v + lim) / (2 * lim)) * (W - PL - PR);
  const forecast = meta?.verdict === "forecast";
  return (
    <figure className="glass-panel p-3">
      <figcaption className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-text-primary">Swing Quality</span>
        <span className="font-data text-xl text-text-primary">{row.g}</span>
        <span className="text-[11px] text-text-dim">{ordinal(row.pct)} pct · {row.nbip} BIP · reliability {row.rel}</span>
        <span className="rounded-full border border-white/[0.12] px-2 py-0.5 text-[10px] text-text-dim">
          {forecast ? "tested forecast (§98a)" : "descriptive, not a forecast"}
        </span>
      </figcaption>
      <p className="text-[12px] text-text-secondary leading-snug">{row.story}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full max-w-[720px]" role="img" aria-label="Swing Quality split by component">
        <line x1={px(0)} x2={px(0)} y1={4} y2={H - 16} stroke="rgba(255,255,255,0.25)" />
        {keys.map((k, i) => {
          const v = row.parts[k], y = 6 + i * ROW, x0 = px(Math.min(0, v)), x1 = px(Math.max(0, v));
          return (
            <g key={k}>
              <text x={PL - 8} y={y + 12} textAnchor="end" className="fill-current text-text-secondary" fontSize="10">{LABEL[k]}</text>
              <rect x={x0} y={y + 2} width={Math.max(1, x1 - x0)} height={13} rx={2} fill={toneColor(v, false, 1) ?? "#8b93a7"} opacity={0.75} />
              <text x={W - PR + 6} y={y + 12} className="fill-current text-text-dim" fontSize="10" fontFamily="var(--font-data, monospace)">
                {signedFixed(v, 1)}
              </text>
            </g>
          );
        })}
        <text x={px(-lim)} y={H - 3} fontSize="9" className="fill-current text-text-dim">← costs grade points</text>
        <text x={px(lim)} y={H - 3} fontSize="9" textAnchor="end" className="fill-current text-text-dim">adds grade points →</text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <span>Swing says <span className="font-data text-text-primary">{row.sq.toFixed(3).replace(/^0/, "")}</span> xwOBAcon</span>
        <span>Results <span className="font-data text-text-primary">{row.xwcon.toFixed(3).replace(/^0/, "")}</span></span>
        <span>Results vs swing <Signed v={row.gap} dp={0} /> pts</span>
      </div>
      <p className="mt-1.5 text-[10px] text-text-dim leading-snug">
        Grade = the xwOBA on contact his swings should produce from bat speed, swing plane, where he met the ball and what he
        swung at; 100 = league, 10 points = one SD. Bars sum to the grade minus 100. {meta?.note}
      </p>
    </figure>
  );
}
