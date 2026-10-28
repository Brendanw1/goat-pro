"use client";

/**
 * The Visuals tab — the college front end's chart library on MLB data. All
 * six reads of a pitcher's season, each fed by the bake (`visuals/` family):
 * the radar gun, the spin clock, the release point, where the pitches cross
 * the zone, what each count gets, and how usage splits by batter hand.
 * Everything here is measured; nothing is graded.
 *
 * Hitter side: the pitches-seen surfaces (his zone, mirrored by stand).
 */

import { VeloDistribution } from "@/components/charts/velo-distribution";
import { SpinClock } from "@/components/charts/spin-clock";
import { ReleaseCloud } from "@/components/charts/release-cloud";
import { LocationSurfaces } from "@/components/charts/location-surfaces";
import { CountLattice } from "@/components/charts/count-lattice";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title}</h2>
        {note && <span className="text-[10px] text-text-dim">{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** Usage vs batter hand, back to back — shares of HIS pitches to each hand. */
function UsageVsHand({ rows }: { rows: { t: string; n: number; lhb: number | null; rhb: number | null; delta: number | null }[] }) {
  if (!rows?.length) return <p className="text-xs text-text-dim">No handedness split for this season.</p>;
  const max = Math.max(...rows.flatMap((r) => [r.lhb ?? 0, r.rhb ?? 0]));
  return (
    <div className="space-y-1.5 mt-2">
      {rows.map((r) => (
        <div key={r.t} className="flex items-center gap-2 text-xs">
          <span className="w-8 font-data font-medium" style={{ color: colorOf(r.t) }}>{r.t}</span>
          <div className="flex-1 flex items-center justify-end gap-1">
            <span className="text-[10px] text-text-dim font-data w-9 text-right">{r.lhb?.toFixed(1) ?? "—"}%</span>
            <div className="h-[10px] rounded-l" style={{ width: `${((r.lhb ?? 0) / max) * 42}%`, background: colorOf(r.t), opacity: 0.55 }} title={`vs LHB: ${r.lhb ?? "—"}% of his pitches`} />
          </div>
          <div className="flex-1 flex items-center gap-1">
            <div className="h-[10px] rounded-r" style={{ width: `${((r.rhb ?? 0) / max) * 42}%`, background: colorOf(r.t), opacity: 0.9 }} title={`vs RHB: ${r.rhb ?? "—"}% of his pitches`} />
            <span className="text-[10px] text-text-dim font-data w-9">{r.rhb?.toFixed(1) ?? "—"}%</span>
          </div>
          <span className="w-12 text-right text-[10px] font-data"
            style={{ color: r.delta == null ? undefined : Math.abs(r.delta) < 5 ? undefined : r.delta > 0 ? "#5ba88f" : "#e0654f" }}>
            {r.delta == null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta}`}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-[9px] text-text-dim pt-1">
        <span className="flex-1 text-right">vs LHB ◀</span>
        <span>▶ vs RHB</span>
        <span className="flex-1">Δ pts</span>
      </div>
      <p className="text-[10px] text-text-dim leading-[1.5]">
        Each bar is how his pitches divide between the two batter hands (bars meet in the middle). The Δ column is the
        platoon lean in points — green means he goes to the pitch more against lefties.
      </p>
    </div>
  );
}

/**
 * D-10: release tells — how far apart his types LEAVE the hand, in standardized
 * and raw units, from the release clouds the bake already ships. Two types that
 * overlap at release are hard to tell apart out of the hand; a type that drops
 * a couple of inches is a tell, in the scouting sense of the word.
 */
function ReleaseTells({ release }: { release: any }) {
  const types = Object.entries<any>(release?.types ?? {}).filter(([, v]) => v.n >= 20) as [string, any][];
  if (types.length < 2) return <p className="text-xs text-text-dim">Needs two tracked pitch types.</p>;
  const rows: { a: string; b: string; ds: number; dh: number; z: number }[] = [];
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const [a, va] = types[i], [b, vb] = types[j];
      const ds = Math.abs(va.rs - vb.rs), dh = Math.abs(va.rh - vb.rh);
      const z = Math.sqrt((ds / Math.max(0.05, Math.hypot(va.sds, vb.sds))) ** 2 +
                          (dh / Math.max(0.05, Math.hypot(va.sdh, vb.sdh))) ** 2);
      rows.push({ a, b, ds, dh, z });
    }
  }
  rows.sort((x, y) => y.z - x.z);
  const read = (z: number) => (z < 2 ? "nearly the same slot" : z < 4 ? "distinguishable out of the hand" : "a clear release difference");
  return (
    <div className="space-y-1.5 mt-1">
      {rows.slice(0, 6).map((r) => (
        <div key={`${r.a}-${r.b}`} className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-text-secondary">
            <span className="font-data" style={{ color: colorOf(r.a) }}>{r.a}</span>
            <span className="text-text-dim"> vs </span>
            <span className="font-data" style={{ color: colorOf(r.b) }}>{r.b}</span>
          </span>
          <span className="text-text-secondary">
            {r.ds.toFixed(2)}" side · {r.dh.toFixed(2)}" high — <span className="text-text-dim">{read(r.z)}</span>
          </span>
        </div>
      ))}
      <p className="text-[10px] text-text-dim leading-[1.5] pt-1">
        Release-side and height gaps between his types, ranked by how separated they are in standard deviations of his
        own spread. The §7 release file carries the full clouds; this is the read a scouting opinion would state.
      </p>
    </div>
  );
}

/** D-11: what he goes to next — consecutive type pairs within a plate appearance. */
function TransitionMatrix({ seq }: { seq: [string, number][] | null }) {
  if (!seq?.length) return <p className="text-xs text-text-dim">No sequences for this season.</p>;
  const types = [...new Set(seq.flatMap(([k]) => k.split(">")))];
  const fromTotals: Record<string, number> = {};
  for (const [k, n] of seq) fromTotals[k.split(">")[0]] = (fromTotals[k.split(">")[0]] ?? 0) + n;
  const cell = (a: string, b: string) => {
    const n = seq.find(([k]) => k === `${a}>${b}`)?.[1] ?? 0;
    return n / Math.max(1, fromTotals[a] ?? 1);
  };
  const max = Math.max(...seq.map(([, n]) => n));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="text-[10px] font-data">
          <thead>
            <tr>
              <th className="pr-2 text-left text-text-dim font-semibold uppercase tracking-wider text-[9px]">from ↓ to →</th>
              {types.map((t) => (
                <th key={t} className="px-1.5 py-1 font-data" style={{ color: colorOf(t) }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((a) => (
              <tr key={a}>
                <td className="pr-2 font-data" style={{ color: colorOf(a) }}>{a}</td>
                {types.map((b) => {
                  const n = seq.find(([k]) => k === `${a}>${b}`)?.[1] ?? 0;
                  const f = cell(a, b);
                  return (
                    <td key={b} className="px-0.5 py-0.5">
                      <div title={`${a} then ${b}: ${n} times (${Math.round(f * 100)}% of his ${a}s followed by another pitch)`}
                        className="flex items-center justify-center rounded-[3px] min-w-[34px] h-[22px] font-data"
                        style={{ background: n ? `rgba(232,119,34,${0.06 + 0.55 * (n / max)})` : "rgba(255,255,255,0.02)",
                                 color: n > max * 0.55 ? "#1a1208" : "var(--text-secondary)" }}>
                        {n ? `${Math.round(f * 100)}%` : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5]">
        Of every pitch that ended in him throwing another, the share that went to each type next. Same-type repeats
        (the diagonal he does not have) are left out — a repeat is the absence of a decision.
      </p>
    </div>
  );
}

/** D-10: how his shapes moved across the seasons he has at this level. */
function MovementBySeason({ career }: { career: any | null }) {
  const seasons = (career?.seasons ?? []).filter((s: any) => (s.mix ?? []).some((m: any) => m[2] != null));
  if (seasons.length < 1) return null;
  const types: string[] = [...new Set<string>(seasons.flatMap((s: any) => s.mix.filter((m: any) => m[2] != null).map((m: any) => m[0] as string)))];
  const W = 420, H = 340, PAD = 34;
  const pts: any[] = seasons.flatMap((s: any, si: number) => s.mix.filter((m: any) => m[2] != null).map((m: any) => ({ s: s.s, si, t: m[0], v: m[2], ivb: m[3], hb: m[4] })));
  const ivbLo = Math.min(-25, ...pts.map((p) => p.ivb)) - 2, ivbHi = Math.max(25, ...pts.map((p) => p.ivb)) + 2;
  const hbLo = Math.min(-25, ...pts.map((p) => p.hb)) - 2, hbHi = Math.max(25, ...pts.map((p) => p.hb)) + 2;
  const sx = (v: number) => PAD + ((v - hbLo) / (hbHi - hbLo)) * (W - 2 * PAD);
  const sy = (v: number) => H - PAD - ((v - ivbLo) / (ivbHi - ivbLo)) * (H - 2 * PAD);
  const latest = seasons[seasons.length - 1].s;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[520px] h-auto" role="img" aria-label="Average break by pitch type, season by season">
        <line x1={sx(hbLo)} y1={sy(0)} x2={sx(hbHi)} y2={sy(0)} stroke="currentColor" className="text-border-subtle" />
        <line x1={sx(0)} y1={sy(ivbLo)} x2={sx(0)} y2={sy(ivbHi)} stroke="currentColor" className="text-border-subtle" />
        {types.map((t) => {
          const path = seasons.map((s: any) => {
            const m = (s.mix ?? []).find((x: any) => x[0] === t && x[2] != null);
            return m ? { s: s.s, x: sx(m[4]), y: sy(m[3]), v: m[2], ivb: m[3], hb: m[4] } : null;
          }).filter(Boolean) as any[];
          if (path.length < 1) return null;
          return (
            <g key={t}>
              {path.length > 1 && (
                <path d={`M ${path.map((p) => `${p.x} ${p.y}`).join(" L ")}`} fill="none"
                  stroke={colorOf(t)} strokeOpacity={0.35} strokeDasharray="3 3" />
              )}
              {path.map((p) => (
                <circle key={p.s} cx={p.x} cy={p.y} r={p.s === latest ? 4.5 : 3}
                  fill={colorOf(t)} fillOpacity={p.s === latest ? 0.9 : 0.35}>
                  <title>{`${t} ${p.s}: ${p.v} mph · ${p.ivb > 0 ? "+" : ""}${p.ivb} IVB · ${p.hb > 0 ? "+" : ""}${p.hb} HB`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        <text x={W / 2} y={H - 6} textAnchor="middle" className="fill-text-dim" fontSize="9" letterSpacing="0.08em">GLOVE ← HB (IN) → ARM</text>
        <text x={12} y={H / 2} className="fill-text-dim" fontSize="9" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">← IVB</text>
        <text x={PAD} y={PAD - 14} className="fill-text-dim" fontSize="9">large dot = latest season</text>
      </svg>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5]">
        Each dot is a season&apos;s average shape for the type; dashed lines connect it across years. A dot that moves
        is a shape that changed — a new grip, a new seam, a new pitch wearing an old name.
      </p>
    </div>
  );
}

export function PitcherVisualsTab({ visuals, career }: { visuals: any | null; career: any | null }) {
  if (!visuals) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Visuals</h2>
        <p className="text-[11px] text-text-dim">No chart dataset for this player-season.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Panel title="The radar gun" note="one curve per pitch, area = usage">
        <VeloDistribution velo={visuals.velo ?? null} colorOf={colorOf} />
      </Panel>
      <Panel title="Where the pitches cross" note="density per pitch type">
        <LocationSurfaces loc={visuals.loc ?? null} zone={visuals.zone ?? null} colorOf={colorOf} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Spin clock" note="angle = direction · radius = rate">
          <SpinClock dots={visuals.spin?.dots ?? null} colorOf={colorOf} />
        </Panel>
        <Panel title="Release point" note="repeat is the read">
          <ReleaseCloud release={visuals.release ?? null} colorOf={colorOf} />
        </Panel>
      </div>
      <Panel title="The count lattice" note="what each count gets">
        <CountLattice counts={visuals.counts ?? null} colorOf={colorOf} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Release tells" note="how far apart his types leave the hand">
          <ReleaseTells release={visuals.release ?? null} />
        </Panel>
        <Panel title="What he goes to next" note="consecutive pairs within a plate appearance">
          <TransitionMatrix seq={visuals.seq ?? null} />
        </Panel>
      </div>
      <Panel title="Shapes across seasons" note="average break per type, season by season">
        <MovementBySeason career={career} />
      </Panel>
      <Panel title="Usage by batter hand" note="share of his pitches">
        <UsageVsHand rows={visuals.hand ?? []} />
      </Panel>
    </div>
  );
}

export function HitterVisualsTab({ visuals }: { visuals: any | null }) {
  if (!visuals?.loc?.types) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Visuals</h2>
        <p className="text-[11px] text-text-dim">No chart dataset for this player-season.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Panel title="Where pitchers come to him" note="pitches seen, density per type">
        <LocationSurfaces loc={visuals.loc} zone={visuals.zone ?? null} stand={visuals.stand} colorOf={colorOf} />
      </Panel>
    </div>
  );
}
