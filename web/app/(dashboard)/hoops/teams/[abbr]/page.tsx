import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { getHoopsTeam, getHoopsTeams } from "@/lib/data-hoops";

export const dynamic = "force-dynamic";

/** One club: season aggregates and the game list (each row links its report). */
export default async function HoopsTeamPage({ params }: {
  params: Promise<{ abbr: string }>;
}) {
  const { abbr } = await params;
  const key = abbr.toUpperCase();
  const doc = await getHoopsTeam(key);
  if (!doc || !Object.keys(doc.seasons).length) notFound();
  const seasons = Object.keys(doc.seasons).sort((a, b) => Number(b) - Number(a));
  const latest = doc.seasons[seasons[0]];

  // franchise name from the teams board (the team file carries it too, but the
  // board is already in hand server-side and covers every baked season)
  const board = await getHoopsTeams();
  const name = board?.seasons[seasons[0]]?.find((t) => t.abbr === key)?.name ?? key;

  return (
    <div className="space-y-5">
      <BackLink fallback="/hoops/teams" className="text-[11px] text-text-dim hover:text-text-secondary" />
      <div>
        <h1 className="text-lg font-semibold text-text-primary">
          {key} <span className="text-text-dim font-normal">{name}</span>
        </h1>
        <p className="text-xs text-text-dim">
          {seasons.map((s) => doc.seasons[s]).map((s) => `${s.w}-${s.l}`).join(" · ")} across{" "}
          {seasons.length} baked season{seasons.length > 1 ? "s" : ""} (latest: {latest.w}-{latest.l})
        </p>
      </div>

      {seasons.map((s) => {
        const agg = doc.seasons[s];
        return (
          <div key={s} className="space-y-2">
            <h2 className="text-sm font-medium text-text-primary">
              {Number(s) - 1}-{String(s).slice(2)} · {agg.w}-{agg.l} · {agg.pts} pts/g ·{" "}
              opp {agg.opp_pts} · REB {agg.reb} · AST {agg.ast} · TOV {agg.tov}
            </h2>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {agg.games.map((g) => (
                <Link key={g.id} href={`/hoops/games/${g.id}`}
                  className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-1.5 text-xs hover:bg-white/[0.04]">
                  <span className="text-text-primary">
                    <span className={g.res === "W" ? "text-usf-green font-medium" : "text-[#e0654f]"}>
                      {g.res}
                    </span>{" "}
                    {g.home ? `vs ${g.opp}` : `@ ${g.opp}`} {g.pts}–{g.opp_pts}
                  </span>
                  <span className="text-text-dim tabular-nums">{g.date}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
