import Link from "next/link";
import { getTrades } from "@/lib/data";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trades" };

/**
 * Trade tracker (owner queue): every MLB-to-MLB trade 2020-26 from the Stats API
 * transactions feed, grouped into deals, with the run value each club got back
 * (pipeline/trades.py). Descriptive: Statcast run value with the new club, not WAR.
 */

type Q = { season?: string; team?: string; when?: string; sort?: string };

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function TradesPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const season = SEASONS.includes(Number(q.season)) ? Number(q.season) : 2025;
  const data = await getTrades(season);
  if (!data) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">Trades have not been baked yet (pipeline/trades.py).</div>;
  }
  const when = q.when === "deadline" ? "deadline" : "all";
  const sort = q.sort === "date" ? "date" : "value";
  const teams: any[] = data.teams ?? [];
  const team = teams.some((t) => t.team === q.team) ? q.team! : "";
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ season: String(season), team, when, sort, ...over })) if (v) p.set(k, String(v));
    return `/trades?${p.toString()}`;
  };

  // the deadline window = its date and the two days before (deals land on the feed a day either side)
  const dl = data.deadline ? new Date(`${data.deadline}T12:00:00Z`).getTime() : null;
  const inWindow = (d: string) => dl != null && Math.abs(new Date(`${d}T12:00:00Z`).getTime() - dl) <= 2 * 864e5;
  // a deal's size = the swing between what the best-off and worst-off club got back
  const swing = (t: any) => { const v = Object.values<number | null>(t.got).map((x) => x ?? 0); return Math.max(...v) - Math.min(...v); };
  const deals = (data.trades ?? [])
    .filter((t: any) => (!team || t.clubs.includes(team)) && (when === "all" || inWindow(t.date)))
    .sort((a: any, b: any) => (sort === "date" ? b.date.localeCompare(a.date) : swing(b) - swing(a)));

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Trades {season}</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Every trade between two MLB clubs, grouped into deals, with what each side got back: Statcast run value
        (runs above average at the plate or on the mound) with the acquiring club from the trade date through today.
        Not WAR: no fielding, position or replacement level. Players who had not reached MLB carry their Pipeline rank
        that year. {data.deadline && <>The {season} deadline fell on {md(data.deadline)}.</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {SEASONS.map((y) => <Link key={y} href={link({ season: String(y), team: "" })} className={chip(y === season)}>{y}</Link>)}
        <span className="mx-1 h-4 w-px bg-white/10" />
        <Link href={link({ when: "all" })} className={chip(when === "all")}>All deals</Link>
        <Link href={link({ when: "deadline" })} className={chip(when === "deadline")}>Deadline week</Link>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <Link href={link({ sort: "value" })} className={chip(sort === "value")}>Biggest swing</Link>
        <Link href={link({ sort: "date" })} className={chip(sort === "date")}>Latest</Link>
        <form method="get" action="/trades" className="ml-auto">
          <input type="hidden" name="season" value={season} />
          <input type="hidden" name="when" value={when} />
          <input type="hidden" name="sort" value={sort} />
          <select name="team" defaultValue={team} className="rounded-md border border-border-subtle bg-transparent px-2 py-1 text-[11px] text-text-secondary">
            <option value="">All clubs</option>
            {[...teams].sort((a, b) => a.team.localeCompare(b.team)).map((t) => <option key={t.team} value={t.team}>{t.team}</option>)}
          </select>
          <button className={`${chip(false)} ml-1`}>Go</button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="glass-panel p-4 self-start">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Net run value from {season} trades</h2>
          <SortableTable className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <SortTh first="asc" className="py-1 text-left font-semibold">Club</SortTh>
                <SortTh className="py-1 text-right font-semibold">Deals</SortTh>
                <SortTh className="py-1 text-right font-semibold">In</SortTh>
                <SortTh first="asc" className="py-1 text-right font-semibold">Out</SortTh>
                <SortTh className="py-1 text-right font-semibold">Net</SortTh>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.team} className={`border-t border-white/[0.04] ${t.team === team ? "bg-white/[0.05]" : ""}`}>
                  <td className="py-1"><Link href={link({ team: t.team })} className="inline-flex items-center gap-1.5 font-sans text-text-secondary hover:underline"><PixelTeamLogo team={t.team} size={14} />{t.team}</Link></td>
                  <td className="py-1 text-right text-text-dim">{t.deals}</td>
                  <td className="py-1 text-right"><Signed v={t.in} dp={1} /></td>
                  <td className="py-1 text-right"><Signed v={t.out} dp={1} lowerIsGood /></td>
                  <td className="py-1 text-right font-semibold"><Signed v={t.net} dp={1} /></td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
          <p className="mt-2 text-[10px] text-text-dim">In = what arrived did for this club; Out = what left did for its new club.</p>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] text-text-dim">{deals.length} deal{deals.length === 1 ? "" : "s"}{team ? ` involving ${team}` : ""}</p>
          {deals.slice(0, 120).map((t: any) => (
            <div key={`${t.date}-${t.desc}`} className="glass-panel p-3">
              <div className="mb-2 flex items-baseline gap-2 text-[11px] text-text-dim">
                <span className="font-data">{md(t.date)}</span>
                {inWindow(t.date) && <span className="rounded border border-usf-gold/40 px-1 text-[9px] uppercase tracking-wider text-usf-gold">deadline</span>}
              </div>
              <div className={`grid gap-3 ${t.clubs.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {t.clubs.map((c: string) => (
                  <div key={c}>
                    <div className="mb-1 flex items-center gap-1.5 text-xs">
                      <PixelTeamLogo team={c} size={16} />
                      <span className="font-semibold text-text-primary">{c} got</span>
                      <span className="ml-auto"><Signed v={t.got[c]} dp={1} /></span>
                    </div>
                    <table className="w-full text-xs font-data">
                      <tbody>
                        {t.players.filter((p: any) => p.to === c).map((p: any) => (
                          <tr key={p.id} className="border-t border-white/[0.04]">
                            <td className="py-0.5 font-sans">
                              <Link prefetch={false} href={`/player/${p.id}?season=${season}`} className="text-text-secondary hover:underline">{p.name}</Link>
                              <span className="ml-1 text-[10px] text-text-dim">{p.pos ?? ""}{p.rank ? ` · ${p.rank}` : ""}</span>
                            </td>
                            <td className="py-0.5 text-right text-[10px] text-text-dim">{p.pa ? `${p.pa} PA` : p.bf ? `${p.bf} BF` : p.debut ? `debut ${p.debut}` : "no MLB"}</td>
                            <td className="py-0.5 pl-2 text-right w-[52px]">{p.rvSince == null ? <span className="text-text-dim">—</span> : <Signed v={p.rvSince} dp={1} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {deals.length > 120 && <p className="text-[11px] text-text-dim">Showing the first 120; pick a club to narrow.</p>}
        </div>
      </div>
    </div>
  );
}
