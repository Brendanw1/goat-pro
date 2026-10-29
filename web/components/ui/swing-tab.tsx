"use client";

/**
 * The Swing tab (depth list item 1): a hitter's swing profile from Statcast
 * bat tracking. The bake (web_export.py `swing` family) carries the drawing —
 * usage-scaled KDEs of bat speed and swing length with a rug of his swing
 * speeds — so this panel renders numbers and curves, never raw pitches.
 *
 * All descriptive. Bat speed and whiff/swing rank against that season's 100+
 * tracked-swing hitters; style reads (swing length, attack angle, path tilt,
 * contact depth) are ranked for context but never coloured — a long swing is
 * a style, not a flaw. Savant-named fields (swords, squared-up, blast,
 * competitive swings) keep Savant's definitions; see the glossary.
 */

import { ordinal, percentileColor } from "@/lib/percentiles";
import { ContactDepthPanel } from "@/components/ui/contact-depth-panel";
import { PlanePanel } from "@/components/ui/plane-panel";
import { TimingPanel } from "@/components/ui/timing-panel";
import { TwoStrikePanel } from "@/components/ui/two-strike-panel";
import { ArchetypeChip } from "@/components/ui/archetype-chip";
import { SwingQPanel } from "@/components/ui/swingq-panel";

const REGION_LABEL: Record<string, string> = {
  heart: "Heart of the zone",
  shadow: "Shadow (edge)",
  chase: "Chase",
  waste: "Waste",
};
const REGION_ORDER = ["heart", "shadow", "chase", "waste"];
const PT_LABEL: Record<string, string> = {
  FF: "Four-seam", SI: "Sinker", CT: "Cutter", SL: "Slider", SW: "Sweeper",
  CB: "Curveball", CH: "Changeup", FS: "Splitter",
};
const VELO_LABEL: Record<string, string> = {
  v85: "≤ 85 mph", "v85-90": "85–90", "v90-95": "90–95", "v95+": "95+",
};
const VELO_ORDER = ["v85", "v85-90", "v90-95", "v95+"];

function PctChip({ v, invert, neutral }: { v: number | null | undefined; invert?: boolean; neutral?: boolean }) {
  if (v == null || !Number.isFinite(v)) return null;
  const shown = Math.round(v);
  if (neutral) return <span className="text-[9px] text-text-dim/80">{ordinal(shown)}</span>;
  return (
    <span className="text-[9px] font-data leading-none" style={{ color: percentileColor(invert ? 100 - shown : shown) }}
      title={`percentile among ${shown === 50 ? "the league's" : ""} qualified swing profiles`}>
      {ordinal(shown)}
    </span>
  );
}

function StatCell({ label, value, sub, pct, invert, neutral }: {
  label: string; value: string; sub?: string | null;
  pct?: number | null | undefined; invert?: boolean; neutral?: boolean;
}) {
  return (
    <div className="px-3 py-2 border-r border-b border-white/[0.04] last:border-r-0">
      <div className="text-[9px] uppercase tracking-wider text-text-dim">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-sm font-data text-text-primary">{value}</span>
        <PctChip v={pct} invert={invert} neutral={neutral} />
      </div>
      {sub ? <div className="text-[9px] text-text-dim mt-0.5 leading-tight">{sub}</div> : null}
    </div>
  );
}

/** One KDE panel: filled curve + rug ticks, y normalised to its own peak. */
function Curve({ dist, xLabel, accent, rug }: {
  dist: any; xLabel: string; accent: string; rug?: number[] | null;
}) {
  if (!dist?.x?.length) return null;
  const W = 460, H = 150, PL = 6, PR = 6, PT = 8, PB = 18;
  const x0 = dist.x[0], x1 = dist.x[dist.x.length - 1];
  const yMax = Math.max(...dist.y, 1e-6);
  const px = (v: number) => PL + ((v - x0) / (x1 - x0)) * (W - PL - PR);
  const py = (v: number) => PT + (1 - v / yMax) * (H - PT - PB);
  const path = dist.x.map((xv: number, i: number) => `${i ? "L" : "M"}${px(xv).toFixed(1)},${py(dist.y[i]).toFixed(1)}`).join("");
  const area = `${path}L${px(x1).toFixed(1)},${(H - PB).toFixed(1)}L${px(x0).toFixed(1)},${(H - PB).toFixed(1)}Z`;
  const ticks: number[] = [];
  for (let v = Math.ceil(x0); v <= x1; v += 5) ticks.push(v);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={xLabel}>
        {rug?.map((v, i) => (
          <line key={i} x1={px(v)} x2={px(v)} y1={H - PB} y2={H - PB - 5} stroke="#8b93a7" strokeWidth={0.7} opacity={0.55} />
        ))}
        <path d={area} fill={accent} opacity={0.16} />
        <path d={path} fill="none" stroke={accent} strokeWidth={1.6} />
        {ticks.map((v) => (
          <text key={v} x={px(v)} y={H - 5} textAnchor="middle" fontSize={9} fill="#8b93a7">{v}</text>
        ))}
        {dist.meta?.peak_x != null && (
          <text x={px(dist.meta.peak_x)} y={py(dist.meta.peak_y) - 5} textAnchor="middle" fontSize={9} fill={accent}>
            {dist.meta.peak_x}
          </text>
        )}
      </svg>
      <div className="text-[9px] text-text-dim text-center -mt-1">{xLabel}</div>
    </div>
  );
}

function SplitTable({ rows, order, labels }: { rows: any; order?: string[]; labels: Record<string, string> }) {
  if (!rows) return null;
  const keys = order ? order.filter((k) => rows[k]) : Object.keys(rows);
  if (!keys.length) return null;
  return (
    <table className="w-full text-xs font-data">
      <thead>
        <tr className="text-[9px] uppercase tracking-wider text-text-dim">
          <th className="py-1 text-left font-semibold">Split</th>
          <th className="py-1 text-right font-semibold">Swings</th>
          <th className="py-1 text-right font-semibold">Bat mph</th>
          <th className="py-1 text-right font-semibold">Length ft</th>
          <th className="py-1 text-right font-semibold">Whiff%</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const c = rows[k];
          return (
            <tr key={k} className="border-t border-white/[0.04]">
              <td className="py-1 font-sans text-text-secondary">{labels[k] ?? k}</td>
              <td className="py-1 text-right text-text-dim">{c.n}</td>
              <td className="py-1 text-right text-text-secondary">{c.avgBatSpeed ?? "—"}</td>
              <td className="py-1 text-right text-text-secondary">{c.swingLength ?? "—"}</td>
              <td className="py-1 text-right text-text-secondary">{c.whiffPct ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SwingTab({ swing, name }: { swing: any | null; name?: string }) {
  if (!swing?.summary) {
    return (
      <div className="glass-panel p-6 text-center text-xs text-text-dim">
        No swing profile for this season — bat tracking covers 2023 on and needs 100 tracked swings.
      </div>
    );
  }
  const s = swing.summary;
  const p = swing.percentiles ?? {};
  const nQual = p.n ?? null;
  const sav = swing.savant ?? {};
  const zone = swing.byZoneRegion ?? {};
  const chase = zone.chase, heart = zone.heart;
  const chaseDrop = chase && heart && chase.avgBatSpeed != null && heart.avgBatSpeed != null
    ? heart.avgBatSpeed - chase.avgBatSpeed : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-dim">
          Swing profile — bat tracking
        </h3>
        <span className="text-[10px] text-text-dim">
          {swing.n?.toLocaleString()} tracked swings · {swing.season}
          {nQual ? ` · percentiles vs ${nQual} hitters with 100+ tracked swings` : ""}
        </span>
      </div>

      <SwingQPanel id={swing.id} season={swing.season} />

      <div className="glass-panel grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 -mb-px">
        <StatCell label="Bat speed" value={`${s.avgBatSpeed ?? "—"}`} sub="mph, all tracked swings (Savant competitive avg below)" pct={p.avgBatSpeed} />
        <StatCell label="Peak (90th)" value={`${s.batSpeedP90 ?? "—"}`} sub="mph" pct={p.bsP90} />
        <StatCell label="Swing length" value={`${s.swingLength ?? "—"}`} sub="ft — style, ranked not coloured" pct={p.swingLength} neutral />
        <StatCell label="Attack angle" value={`${s.attackAngle ?? "—"}°`} sub={sav.idealAttackAngleRate != null ? `${sav.idealAttackAngleRate}% in the ideal 5–20° band` : "bat's upward path — style"} pct={p.attackAngle} neutral />
        <StatCell label="Whiff / swing" value={`${s.whiffPerSwing ?? "—"}%`} pct={p.whiffPerSwing} invert />
        <StatCell label="Swords" value={`${s.swords ?? "—"}`} sub={s.swordRate != null ? `${s.swordRate}% of competitive swings` : null} pct={p.swordRate} invert />
        <StatCell label="Squared-up / swing" value={s.squaredUpPerSwing != null ? `${s.squaredUpPerSwing}%` : "—"} sub="Savant — max-effort contact quality" pct={p.squared_up_per_swing} />
        <StatCell label="Blast / swing" value={s.blastPerSwing != null ? `${s.blastPerSwing}%` : "—"} sub="Savant — squared-up AND fast" pct={p.blast_per_swing} />
        <StatCell label="Hard-swing rate" value={s.hardSwingRate != null ? `${s.hardSwingRate}%` : "—"} sub="Savant" />
        <StatCell label="Path tilt" value={s.pathTilt != null ? `${s.pathTilt}°` : "—"} sub="swing plane tilt — style" />
        <StatCell label="Contact depth" value={s.contactDepth != null ? `${s.contactDepth}"` : "—"} sub="out front (+) vs deep (−) of his body" />
        <StatCell label="Savant bat speed" value={s.savantAvgBatSpeed != null ? `${s.savantAvgBatSpeed}` : "—"}
          sub={s.pctCompetitive != null ? `${s.pctCompetitive}% of swings competitive` : "competitive swings only"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="glass-panel p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">His bat-speed distribution</div>
          <Curve dist={swing.dist?.batSpeed} xLabel="bat speed (mph) — rug: his swings" accent="#e3b341" rug={swing.dist?.batSpeed?.rug} />
        </div>
        <div className="glass-panel p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Swing length distribution</div>
          <Curve dist={swing.dist?.swingLength} xLabel="swing length (ft)" accent="#7da1c4" />
        </div>
      </div>

      <div className="glass-panel p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-dim">Where the swing changes</span>
          {chaseDrop != null && (
            <span className="text-[10px] text-text-dim">
              his chase swings run <span className="text-text-primary font-data">{chaseDrop.toFixed(1)} mph</span> slower than heart-of-the-zone swings
            </span>
          )}
        </div>
        <SplitTable rows={zone} order={REGION_ORDER} labels={REGION_LABEL} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="glass-panel p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">By pitch type faced</div>
          <SplitTable rows={swing.byPitchType} labels={PT_LABEL} />
        </div>
        <div className="glass-panel p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">By pitcher hand and velocity</div>
          <SplitTable rows={{
            ...(swing.byHand?.vsL ? { vsL: swing.byHand.vsL } : {}),
            ...(swing.byHand?.vsR ? { vsR: swing.byHand.vsR } : {}),
          }} labels={{ vsL: "vs LHP", vsR: "vs RHP" }} />
          <div className="mt-2 border-t border-white/[0.04] pt-2">
            <SplitTable rows={swing.byVeloBand} order={VELO_ORDER} labels={VELO_LABEL} />
          </div>
        </div>
      </div>

      <div className="glass-panel p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">By count</div>
        <SplitTable rows={swing.byCount} labels={Object.fromEntries(Object.keys(swing.byCount ?? {}).map((k) => [k, k]))} />
      </div>

      {(swing.trend?.length ?? 0) > 1 && (
        <div className="glass-panel p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">Swing by season (50+ tracked swings)</div>
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="py-1 text-left font-semibold">Season</th>
                <th className="py-1 text-right font-semibold">Swings</th>
                <th className="py-1 text-right font-semibold">Bat mph</th>
                <th className="py-1 text-right font-semibold">Length</th>
                <th className="py-1 text-right font-semibold">Attack°</th>
                <th className="py-1 text-right font-semibold">Whiff%</th>
              </tr>
            </thead>
            <tbody>
              {swing.trend.map((t: any) => (
                <tr key={t.season} className={`border-t border-white/[0.04] ${t.season === swing.season ? "text-text-primary" : ""}`}>
                  <td className="py-1 font-sans">{t.season}</td>
                  <td className="py-1 text-right text-text-dim">{t.n}</td>
                  <td className="py-1 text-right">{t.avgBatSpeed ?? "—"}</td>
                  <td className="py-1 text-right">{t.swingLength ?? "—"}</td>
                  <td className="py-1 text-right">{t.attackAngle ?? "—"}</td>
                  <td className="py-1 text-right">{t.whiffPerSwing ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContactDepthPanel id={swing.id} season={swing.season} />
      <PlanePanel id={swing.id} season={swing.season} />
      <div className="grid gap-3 lg:grid-cols-2"><TimingPanel id={swing.id} season={swing.season} /><TwoStrikePanel id={swing.id} season={swing.season} /></div>
      <ArchetypeChip id={swing.id} season={swing.season} />

      <p className="text-[10px] text-text-dim leading-relaxed max-w-[95ch]">
        Statcast bat tracking (2023 on, tracked swings only; the minors carry no bat data). Our bat-speed average
        covers every tracked swing so it reads a touch under Savant&apos;s, which averages competitive swings only — both
        are shown. Swords, squared-up, blast, hard-swing and competitive rates are Savant&apos;s own definitions
        (glossary). Swing length, attack angle, path tilt and contact depth describe style: ranked for context,
        never coloured as good or bad.
      </p>
    </div>
  );
}
