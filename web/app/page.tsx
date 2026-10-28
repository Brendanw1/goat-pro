import Link from "next/link";
import { getPitchers, getHitters, getTicker, getRecentGames } from "@/lib/data";
import { TickerStrip } from "@/components/ui/ticker-strip";
import { logoUrl } from "@/lib/team-pixel";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";

// Everything here reads R2; the home page renders at request time.
export const dynamic = "force-dynamic";

/**
 * The home page (D-26): where the day went, who leads the site's boards, and
 * the newest game reports. Leaders are gate-respecting — only HIGH/MODERATE
 * confidence grades rank, and every number stays under the descriptive label.
 */

function LeaderList({ title, rows, metric, fmt, href, note }: {
  title: string; rows: any[]; metric: string; fmt: (v: number) => string;
  href: string; note?: string;
}) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title}</h2>
        <Link href={href} className="text-[10px] text-text-dim hover:text-text-secondary">full board →</Link>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const crest = logoUrl(r.team);
          return (
            <li key={`${r.id}-${r.season}`} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-[10px] font-data text-text-dim text-right">{i + 1}</span>
              {crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={crest} alt="" width={16} height={16} className="rounded" />
              ) : <PixelTeamLogo team={r.team} size={14} />}
              <Link href={`/player/${r.id}?season=${r.season}`} className="text-text-primary hover:underline truncate flex-1">
                {r.name ?? r.id}
              </Link>
              <span className="text-[10px] font-data text-text-dim">{r.season}</span>
              <span className="font-data font-medium text-text-primary w-[52px] text-right">{fmt(r[metric])}</span>
            </li>
          );
        })}
        {!rows.length && <li className="text-[11px] text-text-dim">Not baked yet.</li>}
      </ul>
      {note && <p className="text-[9px] text-text-dim mt-2 leading-[1.5]">{note}</p>}
    </div>
  );
}

export default async function Home() {
  const [pitchers, hitters, ticker, recent] = await Promise.all([
    getPitchers(), getHitters(), getTicker(), getRecentGames(),
  ]);
  const qual = (r: any) => r.confidence === "HIGH" || r.confidence === "MODERATE";
  const pRows = (pitchers ?? []).filter(qual).filter((r: any) => typeof r.stuffPlus === "number");
  const rvRows = (pitchers ?? []).filter((r: any) => (r.ip ?? 0) >= 40 && typeof r.rvPer100 === "number");
  const hRows = (hitters ?? []).filter((r: any) => (r.pa ?? 0) >= 200 && typeof r.woba === "number");
  const top = (rows: any[], key: string, n = 6, desc = true) =>
    [...rows].sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])).slice(0, n);
  const games = (recent?.games ?? []).slice(0, 8);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">GOAT-Pro</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <span className="inline-flex items-center rounded border border-usf-gold/50 bg-usf-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-usf-gold">
          Descriptive — not a forecast
        </span>
        <span className="text-[11px] text-text-dim">MLB + AAA, measured first, every grade under its label.</span>
      </div>

      <TickerStrip ticker={ticker} />

      <div className="grid gap-4 md:grid-cols-3">
        <LeaderList title="Whiff+ leaders" rows={top(pRows, "stuffPlus")} metric="stuffPlus"
          fmt={(v) => String(Math.round(v))} href="/pitchers"
          note="shape → bat-missing, HIGH/MODERATE confidence only" />
        <LeaderList title="Run value / 100 (measured)" rows={top(rvRows, "rvPer100")} metric="rvPer100"
          fmt={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} href="/pitchers?sort=rvPer100"
          note="40+ IP; runs prevented per 100 pitches, actual outcomes" />
        <LeaderList title="Hitters by wOBA" rows={top(hRows, "woba")} metric="woba"
          fmt={(v) => v.toFixed(3).replace(/^0/, ".")} href="/hitters"
          note="200+ PA; weights from this site's own run data" />
      </div>

      <div className="glass-panel p-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Latest game reports</h2>
          <span className="text-[10px] text-text-dim font-data">{games[0]?.d ?? ""}</span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {games.map((g: any) => {
            const [hs, as_] = Array.isArray(g.final) ? g.final : [0, 0];
            return (
              <Link key={g.g} href={`/games/${g.g}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs hover:bg-white/[0.04]">
                <span className="truncate text-text-secondary">
                  {g.away} <span className={`font-data ${as_ > hs ? "text-text-primary font-medium" : ""}`}>{as_}</span>
                  {" @ "}
                  <span className="font-data">{g.home}</span>{" "}
                  <span className={`font-data ${hs > as_ ? "text-text-primary font-medium" : ""}`}>{hs}</span>
                </span>
                <span className="text-[10px] text-text-dim">report →</span>
              </Link>
            );
          })}
          {!games.length && <p className="text-[11px] text-text-dim">No recent games baked.</p>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 text-xs">
        {[
          { href: "/minors?src=sc", label: "Minors, the Statcast board", read: "AAA from 2023: the advanced read plus Whiff+, labelled MLB model on AAA data." },
          { href: "/arsenal/mix-board", label: "The mix board", read: "how many pitches he has, how evenly he uses them, how far apart they are." },
          { href: "/hitters?view=skill", label: "The skill board", read: "every hitter's 20-80 estimates and approach dial, descriptive by design." },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="glass-panel p-4 hover:bg-white/[0.03] transition-colors">
            <p className="font-medium text-text-primary mb-1">{c.label}</p>
            <p className="text-[11px] text-text-dim leading-[1.5]">{c.read}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
