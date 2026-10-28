"use client";
/**
 * "Why each pitch grades what it does" on Whiff+ (port of the college site's components/ui/stuff-breakdown.tsx):
 * one card per pitch type plus the pitcher's overall grade, a diverging bar per input group in Whiff+ points.
 * Data: /api/data/whiff-shap/{id}?season= (pipeline/whiff_shap.py). MLB only; renders nothing without a file.
 */
import { useEffect, useState } from "react";
import { GOOD, BAD } from "@/components/ui/shared-ui";
import { FEATURE_LABEL, groupPoints, type WhiffShap, type WhiffShapRow } from "@/lib/whiff-shap";

const NAME: Record<string, string> = { FF: "Four-seam", SI: "Sinker", CT: "Cutter", SL: "Slider", SW: "Sweeper", CB: "Curveball", CH: "Changeup", FS: "Splitter" };
const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

function Card({ row, scale, title }: { row: Pick<WhiffShapRow, "grade" | "n" | "points">; scale: number; title: string }) {
  // the fold baseline is noise around 0; it stays in the sum but only shows when it is big enough to read
  const groups = groupPoints(row.points).filter((g) => Math.abs(g.v) >= 0.05);
  return (
    <div className="rounded-lg border border-border-subtle bg-white/[0.02] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-text-primary">{title}</span>
        <span className="font-data text-xs tabular-nums text-text-secondary">
          <span className="text-sm font-semibold text-text-primary">{Math.round(row.grade)}</span> · {row.n} pitches
        </span>
      </div>
      <ul className="space-y-1">
        {groups.map((g) => {
          const w = Math.min(50, (Math.abs(g.v) / scale) * 50);
          return (
            <li key={g.label} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-2 text-[11px]"
              title={g.parts.length > 1 ? g.parts.map((p) => `${FEATURE_LABEL[p.feat] ?? p.feat} ${fmt(p.v)}`).join(", ") : undefined}>
              <span className="truncate text-text-secondary">{g.label}</span>
              <span className="relative h-2 rounded-full bg-white/[0.04]" aria-hidden="true">
                <span className="absolute top-0 h-2 w-px bg-white/20" style={{ left: "50%" }} />
                <span className="absolute top-0 h-2 rounded-full" style={{ background: g.v > 0 ? GOOD : BAD, width: `${w}%`, left: g.v > 0 ? "50%" : `${50 - w}%` }} />
              </span>
              <span className="text-right font-data tabular-nums" style={{ color: g.v > 0 ? GOOD : BAD }}>{fmt(g.v)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WhiffBreakdown({ playerId, season }: { playerId: string; season: number | string }) {
  const [d, setD] = useState<WhiffShap | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/whiff-shap/${playerId}?season=${season}`).then((r) => (r.ok ? r.json() : null))
      .then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [playerId, season]);
  if (!d) return null;
  const overall = { grade: d.grade, n: d.byType.reduce((a, r) => a + r.n, 0), points: d.overall };
  // one scale across his cards, so a long bar means the same number of points everywhere
  const scale = Math.max(4, ...[overall, ...d.byType].flatMap((r) => groupPoints(r.points).map((g) => Math.abs(g.v))));
  return (
    <div className="glass-panel p-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Why each pitch grades what it does · Whiff+</h2>
      <p className="mt-0.5 mb-3 max-w-3xl text-[11px] text-text-dim">
        Whiff+ points each input adds or takes away compared with the league&apos;s average pitch of that type (the overall card: of
        that pitch class, against the same batter hand). They add up to the grade minus 100. Each pitch is explained by a model
        that never saw his pitches. The model&apos;s view, not proof of what causes whiffs: inputs that move together share credit,
        so hover a row to see its parts.
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card row={overall} scale={scale} title="All pitches (his Whiff+)" />
        {d.byType.map((r) => <Card key={r.type} row={r} scale={scale} title={NAME[r.type] ?? r.type} />)}
      </div>
    </div>
  );
}
