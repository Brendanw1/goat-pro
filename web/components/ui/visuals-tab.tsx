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

export function PitcherVisualsTab({ visuals }: { visuals: any | null }) {
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
