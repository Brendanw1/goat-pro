import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { getHoopsPlayers, hoopsSeasons } from "@/lib/data-hoops";

export const metadata = { title: "Hoops players" };
export const dynamic = "force-dynamic";

/** Player-season leaderboard (descriptive: per-game and per-36 averages). */
export default async function HoopsPlayersPage({ searchParams }: {
  searchParams: Promise<{ season?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const seasons = await hoopsSeasons();
  const season = Number(sp.season) || seasons[0];
  const sort = sp.sort === "pts36" ? "pts36" : "pts";
  const doc = await getHoopsPlayers();
  const rows = [...(doc?.seasons[String(season)] ?? [])]
    .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0))
    .slice(0, 100);
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ season: String(season), sort, ...over });
    return `/hoops/players?${p}`;
  };

  return (
    <div className="space-y-4">
      <BackLink fallback="/hoops" className="text-[11px] text-text-dim hover:text-text-secondary" />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-text-primary">Players</h1>
        <div className="flex gap-1.5 text-[11px]">
          {seasons.map((s) => (
            <Link key={s} href={qs({ season: s })}
              className={`rounded px-2 py-0.5 border ${s === season ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent text-text-dim hover:text-text-secondary"}`}>
              {s - 1}-{String(s).slice(2)}
            </Link>
          ))}
          <span className="text-border-subtle">·</span>
          {(["pts", "pts36"] as const).map((k) => (
            <Link key={k} href={qs({ sort: k })}
              className={`rounded px-2 py-0.5 border ${k === sort ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent text-text-dim hover:text-text-secondary"}`}>
              {k === "pts" ? "per game" : "per 36"}
            </Link>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-dim">
        Top 100 by {sort === "pts" ? "points per game" : "points per 36 minutes"}.
        Descriptive Phase 1 — averages over the validated box-score spine.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums min-w-[560px]">
          <thead>
            <tr className="text-text-dim text-left">
              <th className="font-normal pr-3">#</th>
              <th className="font-normal pr-3">Player</th>
              <th className="font-normal">Team</th><th className="font-normal">Pos</th>
              <th className="font-normal">GP</th><th className="font-normal">GS</th>
              <th className="font-normal">MIN</th><th className="font-normal">PTS</th>
              <th className="font-normal">REB</th><th className="font-normal">AST</th>
              <th className="font-normal">STL</th><th className="font-normal">BLK</th>
              <th className="font-normal">TOV</th>
              <th className="font-normal">pts/36</th><th className="font-normal">reb/36</th>
              <th className="font-normal">ast/36</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-border-subtle/50 hover:bg-white/[0.03]">
                <td className="pr-3 text-text-dim">{i + 1}</td>
                <td className="pr-3">
                  <Link href={`/hoops/players/${r.id}`} className="text-text-primary hover:underline">{r.name}</Link>
                </td>
                <td>{r.team ?? "—"}</td><td>{r.pos ?? "—"}</td>
                <td>{r.gp}</td><td>{r.gs}</td><td>{r.min}</td>
                <td className="font-medium">{r.pts}</td><td>{r.reb}</td><td>{r.ast}</td>
                <td>{r.stl}</td><td>{r.blk}</td><td>{r.tov}</td>
                <td>{r.pts36 ?? "—"}</td><td>{r.reb36 ?? "—"}</td><td>{r.ast36 ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="text-xs text-text-dim">No player seasons baked yet.</p> : null}
    </div>
  );
}
