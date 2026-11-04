import Link from "next/link";
import { getTrades } from "@/lib/data";
import { Signed } from "@/components/ui/shared-ui";
import { DealCard, deadlineWindow } from "../../trades/deal";

/**
 * Trades tab: the club's deals from trades/{season}.json (pipeline/trades.py). Run value since the deal with the
 * acquiring club, not WAR; prospects carry their Pipeline rank that year. Descriptive.
 */

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

export default async function TradesTab({ abbr, season, link }: { abbr: string; season: number; link: (o: Record<string, string>) => string }) {
  const all = await Promise.all(SEASONS.map((y) => getTrades(y)));
  const yr = SEASONS.includes(season) ? season : SEASONS[0];
  const data = all[SEASONS.indexOf(yr)];
  const rows = SEASONS.map((y, i) => {
    const teams: any[] = all[i]?.teams ?? [];
    const t = teams.find((x) => x.team === abbr);
    const rk = t ? 1 + teams.filter((x) => x.net > t.net).length : null;
    return { y, t, rk, n: teams.length };
  });
  const inWindow = deadlineWindow(data?.deadline);
  const deals = (data?.trades ?? []).filter((t: any) => t.clubs.includes(abbr)).sort((a: any, b: any) => b.date.localeCompare(a.date));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
      <div className="glass-panel p-4 self-start">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{abbr} trades by season</h2>
        <table className="w-full text-xs font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="py-1 text-left font-semibold">Year</th>
              <th className="py-1 text-right font-semibold">Deals</th>
              <th className="py-1 text-right font-semibold">In</th>
              <th className="py-1 text-right font-semibold">Out</th>
              <th className="py-1 text-right font-semibold">Net</th>
              <th className="py-1 text-right font-semibold" title="Rank of net run value among the clubs that traded that year">Rk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ y, t, rk, n }) => (
              <tr key={y} className={`border-t border-white/[0.04] ${y === yr ? "bg-white/[0.05]" : ""}`}>
                <td className="py-1"><Link href={link({ season: String(y) })} className="text-text-secondary hover:underline">{y}</Link></td>
                <td className="py-1 text-right text-text-dim">{t?.deals ?? 0}</td>
                <td className="py-1 text-right">{t ? <Signed v={t.in} dp={1} /> : "—"}</td>
                <td className="py-1 text-right">{t ? <Signed v={t.out} dp={1} lowerIsGood /> : "—"}</td>
                <td className="py-1 text-right font-semibold">{t ? <Signed v={t.net} dp={1} /> : "—"}</td>
                <td className="py-1 text-right text-text-dim">{rk ? `${rk}/${n}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-text-dim">
          In = what arrived did for {abbr}; Out = what left did for its new club. Statcast run value from the trade date through
          today, not WAR. Later years have had less time to pay off. All clubs: <Link href={`/trades?season=${yr}&team=${abbr}`} className="underline">Trades</Link>.
        </p>
      </div>
      <div className="space-y-3">
        <p className="text-[11px] text-text-dim">{deals.length} {yr} deal{deals.length === 1 ? "" : "s"} involving {abbr}{SEASONS.includes(season) ? "" : ` (no trade data for ${season}; showing ${yr})`}</p>
        {deals.map((t: any) => <DealCard key={`${t.date}-${t.desc}`} t={t} season={yr} deadline={inWindow(t.date)} first={abbr} />)}
      </div>
    </div>
  );
}
