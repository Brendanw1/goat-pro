import Link from "next/link";
import { getDongBoard } from "@/lib/data";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Would it dong?" };

/**
 * Would it dong (RESULTS-MLB §86, pipeline/dong.py): every MLB batted ball 2020-26 flown through the
 * 30 current parks. Descriptive: what the ball did, not a forecast.
 */

type Q = { season?: string; sort?: string };

const SEASONS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "career"];
const SORTS: [string, string][] = [["xhr", "xHR"], ["hr", "HR"], ["nd", "No-doubters"], ["db", "Doubters"], ["else", "Elsewhere"], ["luck", "HR − xHR"]];

export default async function DongPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const data = await getDongBoard();
  if (!data) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">Would-it-dong has not been baked yet (pipeline/dong.py).</div>;
  }
  const season = SEASONS.includes(q.season ?? "") ? q.season! : "2026";
  const sort = SORTS.some(([k]) => k === q.sort) ? q.sort! : "xhr";
  const parks: string[] = data.parks ?? [];
  const rows: any[] = (season === "career" ? data.career : data.seasons?.[season]) ?? [];
  const key = (r: any) => (sort === "luck" ? r.hr - r.xhr : r[sort]);
  const sorted = [...rows].sort((a, b) => key(b) - key(a)).slice(0, 150);
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => `/dong?${new URLSearchParams({ season, sort, ...over } as Record<string, string>).toString()}`;
  const lg = season === "career" ? null : data.league?.[season];
  const parkRows = lg ? parks.map((p, i) => ({ p, n: lg.per_park[i] })).sort((a, b) => b.n - a.n) : [];
  const parkMean = parkRows.length ? parkRows.reduce((s, r) => s + r.n, 0) / parkRows.length : 0;

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Would it dong</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Every MLB batted ball since 2020 (regular season and postseason), flown through all 30 current parks. Each ball&apos;s
        drag is fit so it lands at its measured Statcast distance in the park it was hit in; it is a home run in a park when it
        is above that park&apos;s wall at the fence. <strong>xHR</strong> = Σ parks/30. HRs split into <strong>no-doubters</strong> (30/30),
        <strong> mostly gone</strong> (8–29) and <strong>doubters</strong> (≤7). <strong>Elsewhere</strong> = balls that were not HRs but clear at
        least one park. Best and worst park = where his batted balls would have produced the most and fewest HRs. Fence
        geometry is published dimensions, interpolated; temperature and wind are ignored. Descriptive, not a forecast.
        Savant&apos;s <a className="underline" href="https://baseballsavant.mlb.com/leaderboard/home-runs" target="_blank" rel="noreferrer">Home Run Tracker</a> is
        the public reference this was checked against (RESULTS-MLB §86).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {SEASONS.map((y) => <Link key={y} href={link({ season: y })} className={chip(y === season)}>{y === "career" ? "2020–26" : y}</Link>)}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {SORTS.map(([k, l]) => <Link key={k} href={link({ sort: k })} className={chip(k === sort)}>{l}</Link>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,260px)]">
        <div className="glass-panel p-4 overflow-x-auto">
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="py-1 text-left font-semibold">Player</th>
                <th className="py-1 text-right font-semibold">HR</th>
                <th className="py-1 text-right font-semibold">xHR</th>
                <th className="py-1 text-right font-semibold">HR − xHR</th>
                <th className="py-1 text-right font-semibold" title="HRs out in all 30 parks">No-doubt</th>
                <th className="py-1 text-right font-semibold" title="HRs out in 8-29 parks">Mostly</th>
                <th className="py-1 text-right font-semibold" title="HRs out in 7 or fewer parks">Doubters</th>
                <th className="py-1 text-right font-semibold" title="Non-HRs that clear at least one park">Elsewhere</th>
                <th className="py-1 text-left font-semibold pl-3">Best park</th>
                <th className="py-1 text-left font-semibold">Worst park</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="py-1"><Link prefetch={false} href={`/player/${r.id}`} className="inline-flex items-center gap-1.5 font-sans text-text-secondary hover:underline"><PixelTeamLogo team={r.tm} size={14} />{r.n}</Link></td>
                  <td className="py-1 text-right text-text-primary">{r.hr}</td>
                  <td className="py-1 text-right">{r.xhr.toFixed(1)}</td>
                  <td className="py-1 text-right"><Signed v={r.hr - r.xhr} dp={1} /></td>
                  <td className="py-1 text-right">{r.nd}</td>
                  <td className="py-1 text-right text-text-dim">{r.mg}</td>
                  <td className="py-1 text-right">{r.db}</td>
                  <td className="py-1 text-right">{r.else}</td>
                  <td className="py-1 pl-3 font-sans text-[11px] text-text-secondary">{parks[r.best[0]]} <span className="font-data text-text-dim">{r.best[1]}</span></td>
                  <td className="py-1 font-sans text-[11px] text-text-secondary">{parks[r.worst[0]]} <span className="font-data text-text-dim">{r.worst[1]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-text-dim">Top 150 of {rows.length}. Best/worst park counts are HRs his batted balls would have hit there.</p>
        </div>

        {lg && (
          <div className="glass-panel p-4 self-start">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">{season} HRs if every ball were hit in…</h2>
            <table className="w-full text-xs font-data">
              <tbody>
                {parkRows.map((r) => (
                  <tr key={r.p} className="border-t border-white/[0.04]">
                    <td className="py-0.5 font-sans text-[11px] text-text-secondary">{r.p}</td>
                    <td className="py-0.5 text-right">{r.n.toLocaleString()}</td>
                    <td className="py-0.5 text-right w-[52px]"><Signed v={(r.n / parkMean - 1) * 100} dp={0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-text-dim">Right column: % vs the 30-park mean. Same balls in every park, so this is geometry and altitude only.</p>
          </div>
        )}
      </div>
    </div>
  );
}
