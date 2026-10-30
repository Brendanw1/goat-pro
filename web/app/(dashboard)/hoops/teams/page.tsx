import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { getHoopsTeams, hoopsSeasons } from "@/lib/data-hoops";

export const metadata = { title: "Hoops teams" };
export const dynamic = "force-dynamic";

/** Team-season standings (descriptive: raw box averages per game). */
export default async function HoopsTeamsPage({ searchParams }: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const seasons = await hoopsSeasons();
  const season = Number(sp.season) || seasons[0];
  const doc = await getHoopsTeams();
  const rows = doc?.seasons[String(season)] ?? [];
  const qs = (s: number) => `/hoops/teams?season=${s}`;

  return (
    <div className="space-y-4">
      <BackLink fallback="/hoops" className="text-[11px] text-text-dim hover:text-text-secondary" />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-text-primary">Teams</h1>
        <div className="flex gap-1.5 text-[11px]">
          {seasons.map((s) => (
            <Link key={s} href={qs(s)}
              className={`rounded px-2 py-0.5 border ${s === season ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent text-text-dim hover:text-text-secondary"}`}>
              {s - 1}-{String(s).slice(2)}
            </Link>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-dim">
        Regular-season averages per game from the box-score spine, cross-validated
        against LUMA Basketball Research. Descriptive Phase 1 — no ratings yet.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums min-w-[640px]">
          <thead>
            <tr className="text-text-dim text-left">
              <th className="font-normal pr-3">Team</th>
              <th className="font-normal">W</th><th className="font-normal">L</th>
              <th className="font-normal">PTS</th><th className="font-normal">opp PTS</th>
              <th className="font-normal">FG</th><th className="font-normal">3PT</th>
              <th className="font-normal">FT</th><th className="font-normal">REB</th>
              <th className="font-normal">AST</th><th className="font-normal">TOV</th>
              <th className="font-normal">STL</th><th className="font-normal">BLK</th>
              <th className="font-normal">paint</th><th className="font-normal">fastbk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.abbr} className="border-t border-border-subtle/50 hover:bg-white/[0.03]">
                <td className="pr-3">
                  <Link href={`/hoops/teams/${t.abbr.toLowerCase()}`} className="text-text-primary hover:underline">
                    {t.abbr} <span className="text-text-dim">{t.name}</span>
                  </Link>
                </td>
                <td>{t.w}</td><td>{t.l}</td>
                <td className="font-medium">{t.pts}</td><td>{t.opp_pts}</td>
                <td>{t.fgm}-{t.fga}</td><td>{t.tpm}-{t.tpa}</td><td>{t.ftm}-{t.fta}</td>
                <td>{t.reb}</td><td>{t.ast}</td><td>{t.tov}</td>
                <td>{t.stl}</td><td>{t.blk}</td>
                <td>{t.paint ?? "—"}</td><td>{t.fastbreak ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="text-xs text-text-dim">No team seasons baked yet.</p> : null}
    </div>
  );
}
