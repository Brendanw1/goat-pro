"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Signed } from "@/components/ui/shared-ui";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

/**
 * Would-it-dong panel for hitter profiles (RESULTS-MLB §86): the season's park counts and the balls that
 * clear at least one of the 30 parks. Ball rows: [date, gamePk, venue, ev, la, dist, spray, parks, hr, post, mask].
 */
export function DongPanel({ playerId, season }: { playerId: string | number; season: string | number }) {
  const [d, setD] = useState<any | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/dong/${playerId}`).then((r) => (r.ok ? r.json() : null)).then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [playerId]);
  if (d === undefined) return null;
  const s = d?.seasons?.[String(season)];
  if (!d || !s) return null;
  const balls: any[] = d.balls.filter((b: any[]) => b[0].startsWith(String(season))).sort((a: any[], b: any[]) => b[7] - a[7]);
  const shown = all ? balls : balls.slice(0, 12);
  const parks: string[] = d.parks;

  return (
    <div className="glass-panel p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Would it dong? · {season}</h2>
        <Link href={`/dong?season=${season}`} className="ml-auto text-[10px] text-text-dim underline">league board</Link>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        {[["HR", s.hr], ["xHR", s.xhr.toFixed(1)], ["No-doubt", `${s.nd}`], ["Mostly", `${s.mg}`], ["Doubters", `${s.db}`], ["Elsewhere", `${s.else}`]].map(([l, v]) => (
          <div key={l as string} className="rounded-md border border-white/[0.06] py-1.5">
            <div className="font-data text-sm text-text-primary">{v}</div>
            <div className="text-[9px] uppercase tracking-wider text-text-dim">{l}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-text-secondary">
        HR − xHR <Signed v={s.hr - s.xhr} dp={1} />. Best park <strong>{parks[s.best[0]]}</strong> ({s.best[1]} HR), worst{" "}
        <strong>{parks[s.worst[0]]}</strong> ({s.worst[1]}), 30-park average {s.avg}.
      </p>
      {balls.length > 0 && (
        <SortableTable className="mt-2 w-full text-[11px] font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <SortTh className="py-0.5 text-left font-semibold">Date</SortTh>
              <SortTh className="py-0.5 text-left font-semibold">Park</SortTh>
              <SortTh className="py-0.5 text-right font-semibold">EV</SortTh>
              <SortTh className="py-0.5 text-right font-semibold">LA</SortTh>
              <SortTh className="py-0.5 text-right font-semibold">Ft</SortTh>
              <SortTh className="py-0.5 pl-2 text-left font-semibold">Parks</SortTh>
              <SortTh className="py-0.5 text-right font-semibold">Result</SortTh>
            </tr>
          </thead>
          <tbody>
            {shown.map((b: any[], i: number) => (
              <tr key={`${b[1]}-${i}`} className="border-t border-white/[0.04]">
                <td className="py-0.5 text-text-dim" data-sort={b[0]}>{b[0].slice(5)}{b[9] ? " (P)" : ""}</td>
                <td className="py-0.5 font-sans text-text-secondary">{b[2] ?? "other"}</td>
                <td className="py-0.5 text-right">{b[3] ?? "—"}</td>
                <td className="py-0.5 text-right" data-sort={b[4] ?? ""}>{b[4] ?? "—"}°</td>
                <td className="py-0.5 text-right">{b[5] ?? "—"}</td>
                <td className="py-0.5 pl-2" data-sort={b[7]} title={parks.filter((_, p) => (Number(BigInt(b[10]) >> BigInt(p)) & 1) === 1).join(", ") || "none"}>
                  <span className="inline-block h-1.5 w-[60px] rounded bg-white/[0.06] align-middle">
                    <span className="block h-full rounded bg-usf-gold/70" style={{ width: `${(b[7] / 30) * 100}%` }} />
                  </span>
                  <span className="ml-1.5 text-text-secondary">{b[7]}/30</span>
                </td>
                <td className={`py-0.5 text-right ${b[8] ? "text-text-primary" : "text-text-dim"}`}>{b[8] ? "HR" : "in play"}</td>
              </tr>
            ))}
          </tbody>
        </SortableTable>
      )}
      {balls.length > 12 && (
        <button onClick={() => setAll(!all)} className="mt-1 text-[10px] text-text-dim underline">{all ? "Show fewer" : `Show all ${balls.length}`}</button>
      )}
      <p className="mt-1 text-[10px] text-text-dim">Balls that clear at least one of the 30 current parks, plus every HR. Hover a bar for the parks. (P) = postseason.</p>
    </div>
  );
}
