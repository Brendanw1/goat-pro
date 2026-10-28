import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

export const TUNNEL_TIP =
  "Tunnel+: chase his pitch pairings draw beyond what their shape explains. Consecutive pitches of different types in one plate appearance are compared where the hitter must decide (23.8 ft from the plate): pairs that stay close there and split late draw extra chase, holding stuff, count, platoon, velocity and the plate separation fixed. 100 = average, 10 = one pairing SD. Descriptive: it adds information about next season's chase beyond his chase rate, but chase rate itself forecasts better (RESULTS-MLB §74).";

type Pair = { from: string; to: string; tunnelPlus: number; n: number; commitSepIn: number | null; plateSepIn: number | null; chaseLiftPts: number | null; rankable: boolean };

const label = (c: string) => PITCH_CONFIG[c as PitchType]?.shortLabel ?? c;

/** Pitcher Tunnel+ plus his most-thrown pairings (rankable ones first in weight, thin ones greyed). */
export function TunnelPairs({ pairs, tunnelPlus, nPairs, rankable }: { pairs: Pair[] | null | undefined; tunnelPlus?: number; nPairs?: number; rankable?: boolean }) {
  if (!pairs || pairs.length === 0) return null;
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle flex items-center gap-3" title={TUNNEL_TIP}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Tunnels <span className="font-normal">· descriptive</span></span>
        {typeof tunnelPlus === "number" && (
          <span className="text-xs text-text-secondary">
            Tunnel+ <span className="font-data font-medium text-text-primary">{tunnelPlus}</span>
            <span className="text-text-dim"> on {nPairs?.toLocaleString("en-US")} pairs{rankable ? "" : " (under 150: not ranked)"}</span>
          </span>
        )}
      </div>
      <div className="overflow-x-auto"><div className="min-w-max">
        <div className="flex px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
          <div className="w-[96px]">Pairing</div>
          <div className="w-[48px] text-right">N</div>
          <div className="w-[76px] text-right" title="Distance between the two pitches 23.8 ft from the plate">At commit</div>
          <div className="w-[64px] text-right" title="Distance between the two pitches at the plate">At plate</div>
          <div className="w-[76px] text-right" title="Chase points the pairing draws beyond its shape (shrunk)">Chase lift</div>
          <div className="w-[64px] text-right" title={TUNNEL_TIP}>Tunnel+</div>
        </div>
        {pairs.slice(0, 10).map((p) => (
          <div key={`${p.from}-${p.to}`} className={`flex items-center px-4 h-[30px] text-xs font-data border-b border-white/[0.025] ${p.rankable ? "text-text-secondary" : "text-text-dim"}`}>
            <div className="w-[96px]">{label(p.from)} → {label(p.to)}</div>
            <div className="w-[48px] text-right">{p.n}</div>
            <div className="w-[76px] text-right">{p.commitSepIn?.toFixed(1)} in</div>
            <div className="w-[64px] text-right">{p.plateSepIn?.toFixed(1)} in</div>
            <div className="w-[76px] text-right">{p.chaseLiftPts == null ? "—" : `${p.chaseLiftPts > 0 ? "+" : ""}${p.chaseLiftPts.toFixed(2)}`}</div>
            <div className="w-[64px] text-right text-text-primary">{p.tunnelPlus}</div>
          </div>
        ))}
      </div></div>
    </div>
  );
}
