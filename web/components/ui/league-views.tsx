"use client";
/**
 * D-36 / D-37 profile visuals:
 *   ProjectionBand — a projection's point, its measured 80% range (pipeline/proj_bands.py: out-of-fold misses at
 *                    this sample size) and the league's middle 80% of the same projection behind it.
 *   LeagueScatter  — every qualified player's xwOBA vs wOBA (Savant scale) for the season, this player ringed.
 *   RvFamilyBars   — run value per 100 pitches by pitch family, signed good-for-him.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GOOD, BAD, signedFixed } from "@/components/ui/shared-ui";

const DIM = "var(--text-dim, #8a93a3)";
const ACCENT = "#e87722";
const dec3 = (v: number) => v.toFixed(3).replace(/^0/, "").replace(/^-0/, "-");

type Bp = { p10: number; p25: number; p50: number; p75: number; p90: number } | null | undefined;

export function ProjectionBand({ label, value, lo, hi, bp, fmt, rank, note }: {
  label: string; value: number | null | undefined; lo: number | null | undefined; hi: number | null | undefined;
  bp: Bp; fmt: (v: number) => string; rank?: number | null; note?: string;
}) {
  if (value == null || lo == null || hi == null) return null;
  const all = [value, lo, hi, ...(bp ? [bp.p10, bp.p90] : [])];
  const pad = (Math.max(...all) - Math.min(...all)) * 0.08 || 0.01;
  const a = Math.min(...all) - pad, b = Math.max(...all) + pad;
  const X = (v: number) => `${((v - a) / (b - a)) * 100}%`;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-text-secondary">{label}</span>
        <span className="font-data text-text-primary">
          {fmt(value)} <span className="text-text-dim">({fmt(lo)} to {fmt(hi)})</span>
          {rank != null && <span className="ml-2 text-text-dim">{rank}th pct</span>}
        </span>
      </div>
      <div className="relative h-4">
        {bp && <div className="absolute top-1.5 h-1 rounded bg-white/10" style={{ left: X(bp.p10), width: `calc(${X(bp.p90)} - ${X(bp.p10)})` }}
          title={`League middle 80%: ${fmt(bp.p10)} to ${fmt(bp.p90)}`} />}
        {bp && <div className="absolute top-0.5 h-3 w-px bg-white/30" style={{ left: X(bp.p50) }} title={`League median ${fmt(bp.p50)}`} />}
        <div className="absolute top-1 h-2 rounded" style={{ left: X(lo), width: `calc(${X(hi)} - ${X(lo)})`, background: ACCENT, opacity: 0.35 }} />
        <div className="absolute top-0 h-4 w-1 -translate-x-1/2 rounded" style={{ left: X(value), background: ACCENT }} />
      </div>
      {note && <p className="mt-0.5 text-[10px] text-text-dim">{note}</p>}
    </div>
  );
}

export function LeagueScatter({ role, season, id, level = "mlb" }: { role: "hitter" | "pitcher"; season: number; id: string; level?: string }) {
  const [pts, setPts] = useState<[string, string, number, number][] | null>(null);
  const [hover, setHover] = useState<[string, string, number, number] | null>(null);
  const router = useRouter();
  useEffect(() => {
    let live = true;
    fetch(`/api/data/league-scatter?role=${role}&season=${season}&level=${level}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setPts(j?.pts ?? []); }).catch(() => live && setPts([]));
    return () => { live = false; };
  }, [role, season, level]);
  const dom = useMemo(() => {
    if (!pts?.length) return null;
    const v = pts.flatMap((p) => [p[2], p[3]]);
    return [Math.min(...v) - 0.01, Math.max(...v) + 0.01] as const;
  }, [pts]);
  if (!pts || !dom || pts.length < 10) return null;
  const S = 300, P = 30;
  const sx = (v: number) => P + ((v - dom[0]) / (dom[1] - dom[0])) * (S - P - 6);
  const sy = (v: number) => S - P - ((v - dom[0]) / (dom[1] - dom[0])) * (S - P - 6);
  const me = pts.find((p) => p[0] === id);
  const shown = hover ?? me;
  const ticks = [dom[0] + 0.01, (dom[0] + dom[1]) / 2, dom[1] - 0.01];
  const ag = role === "pitcher" ? " against" : "";
  return (
    <div className="glass-panel p-4">
      <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Expected vs actual, {season} league</h2>
      <p className="mb-2 min-h-[16px] text-[11px] text-text-secondary">
        {shown ? <>{shown[1]}: xwOBA{ag} {dec3(shown[2])}, wOBA{ag} {dec3(shown[3])}</> : null}
      </p>
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto w-full max-w-[420px]" onMouseLeave={() => setHover(null)}
        role="img" aria-label={`xwOBA${ag} against wOBA${ag} for ${pts.length} players`}>
        <line x1={sx(dom[0])} y1={sy(dom[0])} x2={sx(dom[1])} y2={sy(dom[1])} stroke="#ffffff25" strokeDasharray="4 3" />
        {ticks.map((t) => (
          <g key={t}>
            <text x={sx(t)} y={S - P + 14} fontSize="9" textAnchor="middle" fill={DIM}>{dec3(t)}</text>
            <text x={P - 4} y={sy(t) + 3} fontSize="9" textAnchor="end" fill={DIM}>{dec3(t)}</text>
          </g>
        ))}
        <text x={S / 2} y={S - 2} fontSize="9" textAnchor="middle" fill={DIM}>xwOBA{ag}</text>
        <text x={8} y={S / 2} fontSize="9" textAnchor="middle" fill={DIM} transform={`rotate(-90 8 ${S / 2})`}>wOBA{ag}</text>
        {pts.map((p) => p[0] !== id && (
          <circle key={p[0]} cx={sx(p[2])} cy={sy(p[3])} r={2.4} fill="#7aa5d8" fillOpacity={hover?.[0] === p[0] ? 1 : 0.35}
            className="cursor-pointer" onMouseEnter={() => setHover(p)}
            onClick={() => router.push(`/player/${p[0]}?season=${season}`)} />
        ))}
        {me && <circle cx={sx(me[2])} cy={sy(me[3])} r={5} fill={ACCENT} stroke="#fff" strokeWidth="1.2" />}
      </svg>
      <p className="mt-1 text-[10px] text-text-dim">
        {pts.length} {role === "hitter" ? "hitters with 100+ PA" : "pitchers with 100+ batters faced"}. Dashed line: wOBA = xwOBA.
        {role === "hitter" ? " Above it, his results beat his contact quality." : " Below it, he allowed less than the contact suggests."}
        {" "}Statcast expected stats on Savant&apos;s wOBA scale.
      </p>
    </div>
  );
}

export function RvFamilyBars({ rows, unit }: { rows: { label: string; v: number | null | undefined }[]; unit: string }) {
  const have = rows.filter((r): r is { label: string; v: number } => r.v != null && Number.isFinite(r.v));
  if (!have.length) return null;
  const m = Math.max(0.5, ...have.map((r) => Math.abs(r.v)));
  return (
    <div className="glass-panel p-4">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Run value by pitch family</h2>
      <div className="space-y-1.5">
        {have.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-[72px] text-text-secondary">{r.label}</span>
            <div className="relative h-2.5 flex-1">
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
              <div className="absolute inset-y-0 rounded-sm" style={{
                left: r.v >= 0 ? "50%" : `${50 - (Math.abs(r.v) / m) * 50}%`, width: `${(Math.abs(r.v) / m) * 50}%`,
                background: r.v >= 0 ? GOOD : BAD,
              }} />
            </div>
            <span className="w-[44px] text-right font-data" style={{ color: r.v > 0 ? GOOD : r.v < 0 ? BAD : undefined }}>{signedFixed(r.v, 2)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-text-dim">{unit}, past 100 pitches of the family. Right of centre is good for him.</p>
    </div>
  );
}
