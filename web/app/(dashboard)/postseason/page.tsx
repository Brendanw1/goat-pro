import Link from "next/link";
import { getPostseason } from "@/lib/data";
import { TeamCrest } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Postseason" };

/**
 * Postseason (owner queue): each October 2020-26 as a bracket from the Stats API
 * series feed, every game linked to its report (box score, lineups, PA table, win
 * probability), and the postseason's WPA and run-value leaders from Statcast
 * pitches (pipeline/postseason.py). Descriptive: a few games, context not skill.
 */

type Q = { season?: string; sort?: string };

const ROUNDS: [string, string][] = [["F", "Wild Card"], ["D", "Division Series"], ["L", "Championship Series"], ["W", "World Series"]];
const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const d3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3).replace(/^0/, ""));

function SeriesCard({ s }: { s: any }) {
  return (
    <div className="glass-panel p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[9px] uppercase tracking-wider text-text-dim">
        <span>{s.label}</span>
        {s.bestOf ? <span>best of {s.bestOf}</span> : null}
      </div>
      {s.teams.map((t: any) => (
        <div key={t.abbr} className={`flex items-center gap-1.5 text-xs ${s.winner === t.abbr ? "text-text-primary font-semibold" : s.winner ? "text-text-dim" : "text-text-secondary"}`}>
          <TeamCrest team={t.abbr} size={15} />
          <Link href={`/teams/${t.abbr}`} className="hover:underline">{t.abbr}</Link>
          <span className="ml-auto font-data">{t.wins}</span>
        </div>
      ))}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {s.games.filter((g: any) => g.final).map((g: any) => {
          const awayWon = (g.awayScore ?? 0) > (g.homeScore ?? 0);
          const label = `${g.away} ${g.awayScore}–${g.homeScore} ${g.home}`;
          return g.report ? (
            <Link key={g.gid} href={`/games/${g.gid}`} title={`Game ${g.n} · ${md(g.date)} · ${label}`}
              className="rounded border border-border-subtle px-1 py-0.5 text-[9px] font-data text-text-secondary hover:bg-white/[0.06]">
              G{g.n} {awayWon ? g.away : g.home}
            </Link>
          ) : (
            <span key={g.gid} title={label} className="rounded border border-border-subtle px-1 py-0.5 text-[9px] font-data text-text-dim">G{g.n}</span>
          );
        })}
        {s.games.filter((g: any) => !g.final && !g.ifNecessary && !/postponed|cancel|suspend/i.test(g.status ?? "")).map((g: any) => (
          <span key={g.gid} className="rounded border border-dashed border-border-subtle px-1 py-0.5 text-[9px] font-data text-text-dim" title={g.status}>
            G{g.n} {md(g.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Leaders({ rows, side, sort }: { rows: any[]; side: "H" | "P"; sort: string }) {
  const sorted = [...rows].sort((a, b) => (sort === "rv" ? (b.rv ?? 0) - (a.rv ?? 0) : (b.wpa ?? 0) - (a.wpa ?? 0))).slice(0, 15);
  return (
    <table className="w-full text-xs font-data">
      <thead>
        <tr className="text-[9px] uppercase tracking-wider text-text-dim">
          <th className="py-1 text-left font-semibold">{side === "H" ? "Hitter" : "Pitcher"}</th>
          <th className="py-1 text-right font-semibold">G</th>
          <th className="py-1 text-right font-semibold">{side === "H" ? "PA" : "BF"}</th>
          <th className="py-1 text-right font-semibold" title={side === "H" ? "wOBA" : "wOBA allowed"}>wOBA</th>
          <th className="py-1 text-right font-semibold">K</th>
          <th className="py-1 text-right font-semibold">WPA</th>
          <th className="py-1 text-right font-semibold">RV</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id} className="border-t border-white/[0.04]">
            <td className="py-1 font-sans">
              <span className="inline-flex items-center gap-1.5">
                <TeamCrest team={r.team} size={13} />
                <Link href={`/player/${r.id}`} className="text-text-secondary hover:underline">{r.name}</Link>
              </span>
            </td>
            <td className="py-1 text-right text-text-dim">{r.g}</td>
            <td className="py-1 text-right text-text-dim">{r.pa}</td>
            <td className="py-1 text-right text-text-secondary">{d3(r.woba)}</td>
            <td className="py-1 text-right text-text-dim">{r.k}</td>
            <td className="py-1 text-right"><Signed v={r.wpa} dp={2} /></td>
            <td className="py-1 text-right"><Signed v={r.rv} dp={1} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PostseasonPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const data = await getPostseason();
  const seasons = Object.keys(data?.seasons ?? {}).sort().reverse();
  if (!data || !seasons.length) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">The postseason has not been baked yet (pipeline/postseason.py).</div>;
  }
  const season = seasons.includes(String(q.season)) ? String(q.season) : seasons[0];
  const sort = q.sort === "rv" ? "rv" : "wpa";
  const doc = data.seasons[season];
  const series: any[] = doc.series ?? [];
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => `/postseason?${new URLSearchParams({ season, sort, ...over } as Record<string, string>).toString()}`;
  const ws = series.find((s) => s.round === "W");
  const games = series.flatMap((s) => s.games.filter((g: any) => g.final).map((g: any) => ({ ...g, label: s.label })))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.gid) - Number(a.gid));

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Postseason {season}</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Each October as a bracket: series results from the MLB Stats API, every game linked to its report (box score,
        starting lineups, plate appearances, win probability), and the postseason leaders in win probability added and
        Statcast run value. A handful of games is context, not skill: these are descriptive.
        {ws?.winner ? <> {season}: <span className="text-text-secondary">{ws.winner}</span> won the World Series {ws.teams.map((t: any) => t.wins).sort((a: number, b: number) => b - a).join("–")}.</> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((y) => <Link key={y} href={link({ season: y })} className={chip(y === season)}>{y}</Link>)}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-4 gap-3">
          {ROUNDS.map(([code, name]) => {
            const rs = series.filter((s) => s.round === code);
            return (
              <div key={code} className="flex flex-col">
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{name}</h2>
                <div className="flex flex-1 flex-col justify-around gap-2">
                  {rs.length ? rs.map((s) => <SeriesCard key={s.id} s={s} />) : <span className="text-[11px] text-text-dim">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="glass-panel p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Postseason leaders</h2>
            <span className="ml-auto" />
            <Link href={link({ sort: "wpa" })} className={chip(sort === "wpa")}>WPA</Link>
            <Link href={link({ sort: "rv" })} className={chip(sort === "rv")}>Run value</Link>
          </div>
          <Leaders rows={doc.leaders?.hitters ?? []} side="H" sort={sort} />
          <div className="h-4" />
          <Leaders rows={doc.leaders?.pitchers ?? []} side="P" sort={sort} />
          <p className="mt-2 text-[10px] text-text-dim">
            WPA = win probability added (batting team&apos;s swing per PA; pitchers get the negative). RV = summed Statcast run
            value, runs above average (pitchers negated). wOBA for pitchers is wOBA allowed. Postseason only; site WAR is
            regular season and is not used here.
          </p>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Game log</span>
            <span className="ml-2 text-[10px] text-text-dim">{games.length} games · matchup = that starter against the other club&apos;s lineup</span>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            <table className="w-full text-xs font-data">
              <tbody>
                {games.map((g) => (
                  <tr key={g.gid} className="border-t border-white/[0.04]">
                    <td className="py-1 pl-4 text-text-dim whitespace-nowrap">{md(g.date)}</td>
                    <td className="py-1 pl-2 font-sans text-[10px] text-text-dim">{g.label.replace(/ Series$/, "").replace(/^World$/, "World Series")} G{g.n}</td>
                    <td className="py-1 pl-2 whitespace-nowrap">
                      {g.report ? (
                        <Link href={`/games/${g.gid}`} className="text-text-secondary hover:underline">
                          {g.away} {g.awayScore}–{g.homeScore} {g.home}
                        </Link>
                      ) : <span className="text-text-dim">{g.away} {g.awayScore}–{g.homeScore} {g.home}</span>}
                    </td>
                    <td className="py-1 pl-2 pr-4 text-right font-sans text-[10px] whitespace-nowrap">
                      {(["away", "home"] as const).map((side) => {
                        const sp = g.sp?.[side];
                        const opp = side === "away" ? g.home : g.away;
                        return sp ? (
                          <Link key={side} href={`/matchup?pitcher=${sp.id}&game=${g.gid}&team=${opp}`} title={`${sp.n} vs the ${opp} lineup`}
                            className="ml-2 text-text-dim hover:text-usf-gold">
                            {sp.n.split(" ").slice(-1)[0]} matchup
                          </Link>
                        ) : null;
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
