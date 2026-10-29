"use client";

/**
 * Swing plane by zone (RESULTS-MLB §90b; bake pipeline/plane_match_v2.py `export`). Lives in the Swing tab.
 * His mean attack angle on contact swings per pitch group × plate height, against the league in the same cell.
 * §90b P3 (2025 plane → 2026 contact, confirmed): where his plane runs steeper than his own norm vs league,
 * he makes fewer contacts there, −0.38 pp per degree. A contact read, not damage; descriptive, not a forecast.
 */
import { useEffect, useState } from "react";
import { Signed } from "@/components/ui/shared-ui";
import { PITCH_CONFIG } from "@/lib/constants";

const GROUPS = [["FF", "Four-seam"], ["SI", "Sinker"], ["FC", "Cutter"], ["SL", "Slider/sweeper"], ["CU", "Curve"], ["CH", "Change/split"]] as const;
const HEIGHTS = [["high", "Up (2.68+ ft)"], ["mid", "Middle"], ["low", "Down (< 2.08 ft)"]] as const;
const COLOR: Record<string, string> = { FF: PITCH_CONFIG.FF.color, SI: PITCH_CONFIG.SI.color, FC: PITCH_CONFIG.CT.color, SL: PITCH_CONFIG.SL.color, CU: PITCH_CONFIG.CB.color, CH: PITCH_CONFIG.CH.color };
const deg = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}°`;

/** The finding-stating headline: which height his plane misfits most, and what it costs in contact. */
function headline(cells: any[]): string {
  const byH = HEIGHTS.map(([h, lab]) => {
    const rs = cells.filter((c) => c.cell.endsWith(`-${h}`));
    const n = rs.reduce((s, c) => s + c.n, 0);
    return { h, lab, n, rel: n ? rs.reduce((s, c) => s + c.rel * c.n, 0) / n : 0, pp: n ? rs.reduce((s, c) => s + c.contactPp * c.n, 0) / n : 0 };
  }).filter((x) => x.n >= 40);
  if (!byH.length) return "Too few swings per zone for a plane read.";
  const worst = [...byH].sort((a, b) => a.pp - b.pp)[0];
  const where = worst.h === "high" ? "up in the zone" : worst.h === "low" ? "down in the zone" : "in the middle of the zone";
  if (Math.abs(worst.rel) < 1) return "His plane tracks the league's shape at every height: no zone where it costs contact.";
  return worst.rel > 0
    ? `Steeper than league ${where} → fewer contacts there (about ${Math.abs(worst.pp).toFixed(1)} pp).`
    : `Flatter than league ${where} → more contacts there (about ${Math.abs(worst.pp).toFixed(1)} pp).`;
}

export function PlanePanel({ id, season }: { id: string; season: number | string }) {
  const [d, setD] = useState<any | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/plane/${id}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [id, season]);
  if (d === undefined) return <div className="glass-panel p-4 text-xs text-text-dim">Loading swing plane…</div>;
  if (!d?.cells?.length) return null;
  const at = new Map<string, any>(d.cells.map((c: any) => [c.cell, c]));
  return (
    <figure className="glass-panel p-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-text-primary leading-snug">{headline(d.cells)}</div>
          <div className="text-[10px] text-text-dim">
            Swing plane by zone · {d.season} · {d.n.toLocaleString()} competitive swings as {d.side}HB · attack angle {d.aa}° on contact,
            {" "}{deg(d.offset)} vs league overall
          </div>
        </div>
        <span className="text-[9px] uppercase tracking-wider text-text-dim">contact read, not damage · descriptive, not a forecast</span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[10px] font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="py-1 text-left font-semibold">Height</th>
              {GROUPS.map(([g, lab]) => <th key={g} className="py-1 text-center font-semibold" style={{ color: COLOR[g] }}>{lab}</th>)}
            </tr>
          </thead>
          <tbody>
            {HEIGHTS.map(([h, lab]) => (
              <tr key={h} className="border-t border-white/[0.04]">
                <td className="py-1.5 pr-2 font-sans text-text-secondary whitespace-nowrap">{lab}</td>
                {GROUPS.map(([g]) => {
                  const c = at.get(`${g}-${h}`);
                  return (
                    <td key={g} className="px-1 py-1.5 text-center leading-tight" title={c ? `his AA ${c.aa}° vs league ${c.lgAA}° here; ${c.nContact} contact of ${c.n} swings; contact ${c.contact}%` : "under 20 swings"}>
                      {c ? (
                        <>
                          <div className="text-text-primary">{c.aa}° <span className="text-text-dim">({deg(c.delta)})</span></div>
                          <div><Signed v={c.contactPp} dp={1} /><span className="text-text-dim"> pp</span></div>
                          <div className="text-text-dim">{c.n}</div>
                        </>
                      ) : <span className="text-text-dim">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-text-secondary leading-snug">
        Each cell: his mean attack angle on contact swings (vs the league in that cell), the contact it implies, and his swings there.
        The implied contact uses only the cell-specific part (how much steeper than his own overall offset he swings there) at
        −0.38 pp per degree, the size that held from 2025 to 2026 beyond his own prior contact rate (§90b). Attack angle is a style:
        shown, not graded.
      </p>
    </figure>
  );
}
