import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { getHoopsMeta, getHoopsGames, hoopsSeasons } from "@/lib/data-hoops";

export const metadata = { title: "Hoops" };
export const dynamic = "force-dynamic";

/**
 * Basketball landing (Phase 1, descriptive): the newest season's recent games
 * and the state of the data spine. Every score here is cross-validated —
 * 688/688 game scores and 324 player boxes exact against LUMA Basketball
 * Research (the gate recorded in meta.json by the bake).
 */
export default async function HoopsPage() {
  const meta = await getHoopsMeta();
  const seasons = await hoopsSeasons();
  const latest = seasons[0];
  const doc = latest ? await getHoopsGames(latest) : null;
  const recent = (doc?.games ?? []).slice(0, 12);
  const reg = recent.filter((g) => g.type === "regular");
  const shown = reg.length >= 6 ? reg : recent;

  return (
    <div className="space-y-4">
      <BackLink fallback="/" className="text-[11px] text-text-dim hover:text-text-secondary" />
      <h1 className="text-lg font-semibold text-text-primary">Hoops</h1>
      <p className="text-xs text-text-dim max-w-2xl">
        The basketball program, Phase 1: box scores, game reports with shot
        charts, teams and players — descriptive only. The data spine is
        validated against LUMA Basketball Research before anything renders
        (game scores and boxes agree exactly; assists differ on scorer judgment).
      </p>

      {meta?.validation ? (
        <div className="rounded-lg border border-border-subtle px-3 py-2 text-[11px] text-text-dim max-w-2xl">
          <span className="text-text-secondary">Validation gate {meta.validation.gate}.</span>{" "}
          {meta.validation.games_2024_25} game scores 2024-25, {meta.validation.games_2026_27} to
          date 2026-27, {meta.validation.boxes} player-game boxes vs{" "}
          <span className="text-text-secondary">{meta.validation.credit}</span>
          {" "}({meta.validation.boxes_ast_note}).
        </div>
      ) : null}

      <div className="flex gap-2 text-xs">
        <Link href="/hoops/teams" className="rounded-lg border border-border-subtle px-3 py-1.5 text-text-primary hover:bg-white/[0.04]">Teams</Link>
        <Link href="/hoops/players" className="rounded-lg border border-border-subtle px-3 py-1.5 text-text-primary hover:bg-white/[0.04]">Players</Link>
        {seasons.map((s) => (
          <Link key={s} href={`/hoops/games?season=${s}`}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-text-dim hover:bg-white/[0.04]">
            {meta?.seasons[String(s)] ? `${s - 1}-${String(s).slice(2)} games` : s}
          </Link>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-medium text-text-primary mb-2">
          {doc?.label ?? "Latest"} — recent games
        </h2>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {shown.map((g) => (
            <Link key={g.id} href={`/hoops/games/${g.id}`}
              className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2 text-xs text-text-primary hover:bg-white/[0.04]">
              <span>
                {g.away} {g.away_score} @ {g.home} {g.home_score}
                {g.ot ? <span className="text-text-dim"> · {g.ot}OT</span> : null}
              </span>
              <span className="text-text-dim tabular-nums">{g.date}</span>
            </Link>
          ))}
        </div>
        {!shown.length ? (
          <p className="text-xs text-text-dim">No games baked yet — run <code>pipeline/hoops_export.py</code>.</p>
        ) : null}
      </div>
    </div>
  );
}
