import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { getHoopsGames, getHoopsMeta, hoopsSeasons } from "@/lib/data-hoops";

export const metadata = { title: "Hoops games" };
export const dynamic = "force-dynamic";

const PAGE = 40;

/** A season's game finder. Filters and page ride the query string so the
 *  back button restores them (the RouteTracker stores the full href). */
export default async function HoopsGamesPage({ searchParams }: {
  searchParams: Promise<{ season?: string; type?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const seasons = await hoopsSeasons();
  const meta = await getHoopsMeta();
  const season = Number(sp.season) || seasons[0];
  const type = sp.type === "preseason" || sp.type === "regular" ? sp.type : "all";
  const page = Math.max(0, Number(sp.page) || 0);
  const doc = season ? await getHoopsGames(season) : null;
  const all = (doc?.games ?? []).filter((g) => type === "all" || g.type === type);
  const shown = all.slice(page * PAGE, (page + 1) * PAGE);
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ season: String(season), type, page: String(page), ...over });
    return `/hoops/games?${p}`;
  };

  return (
    <div className="space-y-4">
      <BackLink fallback="/hoops" className="text-[11px] text-text-dim hover:text-text-secondary" />
      <h1 className="text-lg font-semibold text-text-primary">
        Games {doc?.label ?? season ? `· ${doc?.label ?? season}` : ""}
      </h1>

      <div className="flex flex-wrap gap-2 text-[11px]">
        {seasons.map((s) => (
          <Link key={s} href={qs({ season: s, page: 0 })}
            className={`rounded px-2 py-0.5 border ${s === season ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent text-text-dim hover:text-text-secondary"}`}>
            {meta?.seasons[String(s)] ? `${s - 1}-${String(s).slice(2)}` : s}
          </Link>
        ))}
        <span className="text-border-subtle">·</span>
        {(["all", "regular", "preseason"] as const).map((t) => (
          <Link key={t} href={qs({ type: t, page: 0 })}
            className={`rounded px-2 py-0.5 border ${t === type ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent text-text-dim hover:text-text-secondary"}`}>
            {t}
          </Link>
        ))}
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {shown.map((g) => (
          <Link key={g.id} href={`/hoops/games/${g.id}`}
            className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2 text-xs text-text-primary hover:bg-white/[0.04]">
            <span>
              {g.away} {g.away_score} @ {g.home} {g.home_score}
              {g.ot ? <span className="text-text-dim"> · {g.ot}OT</span> : null}
              {g.type !== "regular" ? <span className="text-text-dim"> · {g.type}</span> : null}
            </span>
            <span className="text-text-dim tabular-nums">{g.date}</span>
          </Link>
        ))}
      </div>

      <div className="flex gap-3 text-[11px] text-text-dim">
        {page > 0 ? <Link href={qs({ page: page - 1 })} className="hover:text-text-secondary">← newer</Link> : null}
        {(page + 1) * PAGE < all.length
          ? <Link href={qs({ page: page + 1 })} className="hover:text-text-secondary">older →</Link> : null}
        <span className="ml-auto tabular-nums">{all.length} games</span>
      </div>
    </div>
  );
}
