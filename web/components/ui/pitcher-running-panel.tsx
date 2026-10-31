"use client";

/**
 * The pitcher's side of the running game (pipeline/catcher_export.py → catcher/p/{id}-{season}.json.gz), on the pitcher
 * Overview tab. Lead distances and SB/CS/PK are Savant's pitcher-running-game board (descriptive, labelled theirs);
 * CS against our xCS sums the site's §108a-v2 expected CS over attempts with him on the mound.
 */
import { useEffect, useState } from "react";
import { PctChip, Signed, signedFixed } from "@/components/ui/shared-ui";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

const f = (v: number | null | undefined, nd = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(nd) : "—");
const th = "px-2 py-1 text-right font-semibold";
const td = "px-2 py-1 text-right font-data";

export function PitcherRunningPanel({ playerId, season }: { playerId: string; season: number | string }) {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/catcher/${playerId}?season=${season}&role=p`).then((r) => (r.ok ? r.json() : null))
      .then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [playerId, season]);
  if (!d?.savant) return null;
  const sv = d.savant, o = d.ours;
  return (
    <div className="glass-panel p-4 space-y-3 lg:col-span-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Running game · his side (Savant&apos;s board; CS vs our xCS)</div>
      <p className="text-[11px] text-text-dim max-w-[85ch]">
        <span className="text-text-secondary">What this tells you: </span>how much ground runners take off him and what happens when they go.
        Lead gained is Savant&apos;s distance a runner adds between his first move and release (the public stand-in for time to plate; lower is
        better for the pitcher, the chip ranks it among pitchers with 200+ chances). SB, CS and pickoffs are Savant&apos;s board.
        CS above xCS sums our §108a-v2 expected CS over the attempts with him pitching, so it mixes his hold with his catchers&apos; arms.
      </p>
      <SortableTable className="w-full min-w-max text-[11px]">
        <thead><tr className="text-[10px] uppercase tracking-wider text-text-dim">
          <SortTh className={th}>Chances</SortTh><SortTh className={th}>Att/100</SortTh><SortTh className={th}>Lead ft</SortTh>
          <SortTh className={th}>Lead gained ft</SortTh><SortTh className={th}>League</SortTh><SortTh className={th}>SB</SortTh><SortTh className={th}>CS</SortTh>
          <SortTh className={th}>PK</SortTh><SortTh className={th} title="Savant's runs prevented on the running game">Runs (Savant)</SortTh>
          <SortTh className={th} title="caught stealing against him minus our xCS (2B/3B attempts)">CS vs xCS (ours)</SortTh>
          <SortTh className={th} title="caught stealing against him minus Savant's exp_cs">CS vs Savant exp</SortTh>
        </tr></thead>
        <tbody><tr className="border-t border-border-subtle">
          <td className={`${td} text-text-dim`}>{sv.opps.toLocaleString("en-US")}</td>
          <td className={td}>{f(sv.attRate, 2)}</td>
          <td className={td}>{f(sv.lead)}</td>
          <td className={td}><span className="inline-flex items-center justify-end gap-1.5">{f(sv.gain, 2)}{sv.gainPct != null && <PctChip p={sv.gainPct} />}</span></td>
          <td className={`${td} text-text-dim`}>{f(sv.gainLg, 2)}</td>
          <td className={td}>{sv.sb}</td><td className={td}>{sv.cs}</td><td className={td}>{sv.pk}</td>
          <td className={td}><Signed v={sv.runs} dp={1} /></td>
          <td className={td}>{o ? <span title={`${o.att} attempts · ${o.cs} CS · our xCS ${f(o.xcs)}`}><Signed v={o.csax} dp={1} /></span> : "—"}</td>
          <td className={td}>{o ? <Signed v={o.cs - o.xsav} dp={1} /> : "—"}</td>
        </tr></tbody>
      </SortableTable>
      <div className="text-[10px] text-text-dim">
        {o ? `${o.att} steal attempts of 2B/3B with him pitching: ${o.sb} SB, ${o.cs} CS; our xCS ${f(o.xcs)} (Savant ${f(o.xsav)}). ` : ""}
        Lead gained vs league: {signedFixed(sv.gain - sv.gainLg, 2)} ft. xCS status: {o?.status ?? "ranking confirmed pre-2020; level era-specific; 2027 confirm pending"}.
      </div>
    </div>
  );
}
