"use client";

/**
 * Two-strike adaptation (RESULTS-MLB §93; bake pipeline/two_strike.py). Lives in the Swing tab.
 * Two-strike minus 0–1-strike mean, each swing measured against what a league model expects for that pitch
 * (type, speed, movement, location), so the two-strike pitch mix does not pass for adaptation. All non-bunt
 * tracked swings (the competitive filter drops the slow swings this measures). A style, so neutral colour.
 */
import { useEffect, useState } from "react";
import { ordinal } from "@/lib/percentiles";

const sgn = (v: number, dp: number, u = "") => `${v > 0 ? "+" : ""}${v.toFixed(dp)}${u}`;

export function TwoStrikePanel({ id, season }: { id: number | string; season: number | string }) {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/twostrike/${id}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((j) => live && setD(j)).catch(() => {});
    return () => { live = false; };
  }, [id, season]);
  if (!d?.row) return null;
  const { row: r, meta } = d;
  const lg = meta.league?.[String(season)] ?? {};
  const cells: [string, number | null, number, string][] = [
    ["Bat speed", r.dBS, 1, " mph"], ["Swing length", r.dSL, 2, " ft"], ["Contact depth", r.dDP, 1, " in."], ["Contact rate", r.dCT, 1, " pp"],
  ];
  const lgv: Record<string, number> = { "Bat speed": lg.dBS, "Swing length": lg.dSL, "Contact depth": lg.dDP, "Contact rate": lg.dCT };
  const more = r.dBS < lg.dBS;
  const title = `With two strikes he gives up ${Math.abs(r.dBS).toFixed(1)} mph of bat speed, ${more ? "more" : "less"} than the league's ${Math.abs(lg.dBS).toFixed(1)}`;

  return (
    <figure className="glass-panel p-3">
      <figcaption className="mb-1.5">
        <div className="text-[13px] font-semibold text-text-primary leading-snug">{title}</div>
        <div className="text-[10px] text-text-dim">
          {r.n2k} two-strike vs {r.nOth} other tracked swings · {season} · pitch-adjusted · {ordinal(r.pct)} percentile of ΔBS (low = sheds more)
        </div>
      </figcaption>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map(([label, v, dp, u]) => (
          <div key={label} className="rounded-md border border-white/[0.06] px-2.5 py-1.5">
            <div className="text-[10px] text-text-dim">{label}, 2K − other</div>
            <div className="font-data text-sm text-text-primary">{v == null ? "—" : sgn(v, dp, u)}</div>
            <div className="text-[9px] text-text-dim">league {lgv[label] == null ? "—" : sgn(lgv[label], dp)}</div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-text-secondary leading-snug">
        The adaptation is a stable trait (ΔBS 2K year to year r {meta.yoy?.toFixed(2)}, §93).
        {meta.kClaim
          ? " Hitters who shed more bat speed strike out less than their early-count whiff rate predicts (about 1 pp of K% per SD of ΔBS); each mph shed goes with about 1.6 pp more contact and .009 less xwOBA on contact."
          : ""}{" "}
        Same-season association, descriptive, not a forecast or a cause.
      </p>
    </figure>
  );
}
