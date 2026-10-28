import Link from "next/link";
import { notFound } from "next/navigation";
import { getPitchers, getHitters, getParks , getRecentGames } from "@/lib/data";
import { logoUrl } from "@/lib/team-pixel";
import { TeamTheme } from "@/components/ui/team-theme";

export const metadata = { title: "Team" };

/**
 * A club page (R1, wave 9): both sides' advanced boards cut to one team,
 * season-chipped, link-driven sorts. Server-rendered like the minors and
 * skill views — every control is a link, no client code.
 */

const P_COLS = [
  { key: "ip", label: "IP", nd: 1 }, { key: "era", label: "ERA", nd: 2, asc: true },
  { key: "kPct", label: "K%", nd: 1 }, { key: "bbPct", label: "BB%", nd: 1, asc: true },
  { key: "cswPct", label: "CSW%", nd: 1 }, { key: "whiffPct", label: "Whiff%", nd: 1 },
  { key: "rvPer100", label: "RV/100", nd: 2 }, { key: "stuffPlus", label: "Whiff+" },
];
const H_COLS = [
  { key: "pa", label: "PA" }, { key: "woba", label: "wOBA", nd: 3 }, { key: "avg", label: "AVG", nd: 3 },
  { key: "slg", label: "SLG", nd: 3 }, { key: "ev90", label: "EV90", nd: 1 },
  { key: "hardHitPct", label: "HH%", nd: 1 }, { key: "whiffPct", label: "Whiff%", nd: 1, asc: true },
];
const fmt = (v: unknown, nd?: number): string =>
  typeof v === "number" && Number.isFinite(v) ? (nd != null ? v.toFixed(nd) : String(v)) : "—";

type Q = { season?: string; psort?: string; hsort?: string };

/** Team aggregates: each stat is the club's weighted mean over its board rows (weight = the stat's own
 * denominator), ranked against every club that season. A traded player counts for the team on his board
 * row, so mid-season movers sit with one club. `good` = the direction that is better for the club. */
type Agg = { key: string; label: string; w: string; nd: number; good: 1 | -1; pct?: boolean };
const P_AGG: Agg[] = [
  { key: "era", label: "ERA", w: "ip", nd: 2, good: -1 }, { key: "fip", label: "FIP", w: "ip", nd: 2, good: -1 },
  { key: "kPct", label: "K%", w: "battersFaced", nd: 1, good: 1 }, { key: "bbPct", label: "BB%", w: "battersFaced", nd: 1, good: -1 },
  { key: "cswPct", label: "CSW%", w: "pitches", nd: 1, good: 1 }, { key: "whiffPct", label: "Whiff%", w: "nSwings", nd: 1, good: 1 },
  { key: "gbPct", label: "GB%", w: "battersFaced", nd: 1, good: 1 }, { key: "velo", label: "Avg velo", w: "pitches", nd: 1, good: 1 },
  { key: "rvPer100", label: "RV/100", w: "pitches", nd: 2, good: 1 }, { key: "stuffPlus", label: "Whiff+", w: "pitches", nd: 0, good: 1 },
  { key: "kPlus", label: "K+", w: "battersFaced", nd: 0, good: 1 }, { key: "preventionPlus", label: "Prevention+", w: "battersFaced", nd: 0, good: 1 },
];
const H_AGG: Agg[] = [
  { key: "woba", label: "wOBA", w: "pa", nd: 3, good: 1 }, { key: "obp", label: "OBP", w: "pa", nd: 3, good: 1 },
  { key: "slg", label: "SLG", w: "pa", nd: 3, good: 1 }, { key: "iso", label: "ISO", w: "pa", nd: 3, good: 1 },
  { key: "kPct", label: "K%", w: "pa", nd: 1, good: -1 }, { key: "bbPct", label: "BB%", w: "pa", nd: 1, good: 1 },
  { key: "ev90", label: "EV90", w: "nBip", nd: 1, good: 1 }, { key: "hardHitPct", label: "Hard-hit%", w: "nBip", nd: 1, good: 1 },
  { key: "barrelPct", label: "Barrel%", w: "nBip", nd: 1, good: 1 }, { key: "oSwingPct", label: "Chase%", w: "pa", nd: 1, good: -1 },
  { key: "whiffPct", label: "Whiff%", w: "pa", nd: 1, good: -1 },
];

function teamMeans(rows: any[], aggs: Agg[]): Map<string, Record<string, number>> {
  const by = new Map<string, Record<string, [number, number]>>();
  for (const r of rows) {
    if (typeof r.team !== "string") continue;
    const t = by.get(r.team) ?? {};
    for (const a of aggs) {
      const v = r[a.key], w = r[a.w];
      if (typeof v !== "number" || typeof w !== "number" || !(w > 0)) continue;
      const [s, n] = t[a.key] ?? [0, 0];
      t[a.key] = [s + v * w, n + w];
    }
    by.set(r.team, t);
  }
  return new Map([...by].map(([team, t]) => [team, Object.fromEntries(Object.entries(t).map(([k, [s, n]]) => [k, s / n]))]));
}

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

/** One stat: value, league rank, and a strip with every club as a dot (better = right). */
function StatStrip({ a, team, means }: { a: Agg; team: string; means: Map<string, Record<string, number>> }) {
  const vals = [...means].map(([t, m]) => [t, m[a.key]] as const).filter(([, v]) => Number.isFinite(v));
  const mine = means.get(team)?.[a.key];
  if (mine == null || vals.length < 2) return null;
  const xs = vals.map(([, v]) => v * a.good);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const x = (v: number) => 6 + ((v * a.good - lo) / (hi - lo || 1)) * 148;
  const rank = 1 + vals.filter(([, v]) => v * a.good > mine * a.good).length;
  const top = rank <= Math.ceil(vals.length / 3), bottom = rank > vals.length - Math.ceil(vals.length / 3);
  return (
    <div className="grid grid-cols-[92px_56px_160px_44px] items-center gap-2 py-1">
      <span className="text-[11px] text-text-secondary truncate">{a.label}</span>
      <span className="text-right font-data text-xs text-text-primary">{mine.toFixed(a.nd)}</span>
      <svg viewBox="0 0 160 14" className="w-[160px] h-[14px]" aria-hidden>
        <line x1={6} x2={154} y1={7} y2={7} stroke="rgba(255,255,255,0.08)" />
        {vals.map(([t, v]) => t !== team && <circle key={t} cx={x(v)} cy={7} r={2.4} fill="rgba(255,255,255,0.28)" />)}
        <circle cx={x(mine)} cy={7} r={4.6} fill="var(--color-usf-gold)" stroke="var(--color-usf-green)" strokeWidth={1.5} />
      </svg>
      <span className={`text-right font-data text-[11px] ${top ? "text-emerald-400" : bottom ? "text-rose-400" : "text-text-dim"}`}>
        {ordinal(rank)}
      </span>
    </div>
  );
}

function TeamSummary({ title, aggs, team, rows }: { title: string; aggs: Agg[]; team: string; rows: any[] }) {
  const means = teamMeans(rows, aggs);
  return (
    <div className="glass-panel px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title}</h2>
        <span className="text-[10px] text-text-dim">rank of {means.size} · dots = every club, better → right</span>
      </div>
      {aggs.map((a) => <StatStrip key={a.key} a={a} team={team} means={means} />)}
    </div>
  );
}

function Board({ title, rows, cols, sort, sortBase, link }: {
  title: string; rows: any[]; cols: { key: string; label: string; nd?: number; asc?: boolean }[];
  sort: string; sortBase: string; link: (over: Record<string, string | undefined>) => string;
}) {
  const sortCol = cols.find((c) => c.key === sort) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = a[sortCol.key], y = b[sortCol.key];
    if (x == null) return 1;
    if (y == null) return -1;
    return sortCol.asc ? x - y : y - x;
  }).slice(0, 40);
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title}</h2>
        <span className="text-[10px] text-text-dim">{rows.length} · top 40 shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-xs font-data">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-4 py-2 text-left font-semibold">Player</th>
              <th className="px-2 py-2 text-right font-semibold">Yr</th>
              {cols.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right font-semibold">
                  <Link href={link({ [sortBase]: c.key })} className={c.key === sort ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.id}-${r.season}`} className="border-t border-white/[0.04]">
                <td className="px-4 py-1.5 font-sans">
                  <Link href={`/player/${r.id}?season=${r.season}`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                </td>
                <td className="px-2 py-1.5 text-right text-text-dim">{r.season}</td>
                {cols.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sort ? "text-text-primary" : "text-text-secondary"}`}>{fmt(r[c.key], c.nd)}</td>
                ))}
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={cols.length + 2} className="px-4 py-3 text-[11px] text-text-dim">No rows for this season.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PF_LABEL: Record<string, string> = { "2B": "Doubles", "3B": "Triples", HR: "Home runs", SO: "Strikeouts" };

/** §70 park factors for the club's main venue (most home PA), each with its rank among the 30 main venues. */
function ParkPanel({ parks, team }: { parks: any; team: string }) {
  const venues: any[] = parks?.venues ?? [];
  const main = new Map<string, any>();
  for (const v of venues) if (!main.has(v.team) || v.home_pa > main.get(v.team).home_pa) main.set(v.team, v);
  const mine = main.get(team);
  if (!mine || !parks.shipped?.length) return null;
  const all = [...main.values()];
  return (
    <div className="glass-panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Park factors · {mine.venue} · {parks.window}</h2>
        <span className="text-[10px] text-text-dim">100 = league average; rank 1 = most of that event</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        {parks.shipped.map((c: string) => (
          <div key={c}>
            <p className="text-[11px] text-text-secondary">{PF_LABEL[c] ?? c}</p>
            {(["L", "R"] as const).map((h) => {
              const v = mine.pf?.[c]?.[h];
              if (v == null) return null;
              const rank = 1 + all.filter((o) => (o.pf?.[c]?.[h] ?? -1) > v).length;
              return (
                <p key={h} className="font-data text-[12px] text-text-primary">
                  {h}HB {Math.round(v)} <span className="text-[10px] text-text-dim">#{rank}</span>
                </p>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-text-dim">
        Home vs road rates for both teams over three seasons, shrunk toward average by how much each venue&apos;s sample can say
        (RESULTS-MLB §70). Singles and walks are left off: their factors did not hold up year to year.
      </p>
    </div>
  );
}

export default async function TeamPage({ params, searchParams }: {
  params: Promise<{ abbr: string }>;
  searchParams?: Promise<Q>;
}) {
  const { abbr: raw } = await params;
  const abbr = decodeURIComponent(raw).toUpperCase();
  const q = (await searchParams) ?? {};
  const [pitchers, hitters, parks, recent] = await Promise.all([getPitchers(), getHitters(), getParks(), getRecentGames()]);
  const prows = (pitchers ?? []).filter((r: any) => r.team === abbr);
  const hrows = (hitters ?? []).filter((r: any) => r.team === abbr);
  if (!prows.length && !hrows.length) notFound();

  const seasons = [...new Set([...prows, ...hrows].map((r: any) => r.season))].sort((a: number, b: number) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const pFiltered = prows.filter((r: any) => r.season === season);
  const hFiltered = hrows.filter((r: any) => r.season === season);
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { season: String(season), psort: q.psort ?? "rvPer100", hsort: q.hsort ?? "woba", ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/teams/${abbr.toLowerCase()}?${p.toString()}`;
  };
  const crest = logoUrl(abbr);

  const allP = (pitchers ?? []).filter((r: any) => r.season === season);
  const allH = (hitters ?? []).filter((r: any) => r.season === season);

  return (
    <div className="space-y-4">
      <TeamTheme team={abbr} />
      <div className="flex flex-wrap items-center gap-3">
        {crest ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={crest} alt="" width={34} height={34} className="rounded" />
        ) : null}
        <h1 className="text-lg font-semibold text-text-primary">{abbr}</h1>
        <span className="text-[11px] text-text-dim">team aggregates ranked against the league, then the club&apos;s boards</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s) => (
          <Link key={s} href={link({ season: String(s) })}
            className={`px-2.5 py-1 rounded-md text-[11px] font-data border ${s === season ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`}>
            {s}
          </Link>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <TeamSummary title={`Pitching staff, ${season}`} aggs={P_AGG} team={abbr} rows={allP} />
        <TeamSummary title={`Lineup, ${season}`} aggs={H_AGG} team={abbr} rows={allH} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {(() => {
          // D-25 role depth: the staff split at GS >= 10 — a rotation and a
          // bullpen are different jobs, and one staff mean hides both.
          const starters = prows.filter((r: any) => r.season === season && (r.gs ?? 0) >= 10);
          const relivers = prows.filter((r: any) => r.season === season && (r.gs ?? 0) < 10);
          const wavg = (rows: any[], key: string, wkey: string) => {
            let num = 0, den = 0;
            for (const r of rows) { const x = r[key], w = r[wkey]; if (typeof x === "number" && typeof w === "number") { num += x * w; den += w; } }
            return den ? num / den : null;
          };
          const ipOf = (rows: any[]) => Math.round(rows.reduce((a, r) => a + (r.ip ?? 0), 0));
          const row = (label: string, rows: any[]) => (
            <div className="flex items-baseline justify-between gap-2 py-1 border-b border-white/[0.03] text-[11px]">
              <span className="text-text-secondary">{label}</span>
              <span className="font-data text-text-primary">
                {ipOf(rows)} IP · K% {wavg(rows, "kPct", "battersFaced")?.toFixed(1) ?? "—"} · BB% {wavg(rows, "bbPct", "battersFaced")?.toFixed(1) ?? "—"}
              </span>
            </div>
          );
          return (
            <div className="glass-panel p-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">Role depth, {season}</h2>
              {row("Rotation (GS 10+)", starters)}
              {row("Bullpen", relivers)}
              <p className="mt-2 text-[10px] text-text-dim leading-[1.5]">
                IP-weighted. The split is the read: a rotation carrying innings at one K-BB profile and a bullpen at
                another are two staffs, not one mean.
              </p>
            </div>
          );
        })()}
        <div className="glass-panel p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">Latest games</h2>
          <ul className="space-y-1">
            {(recent?.games ?? []).filter((g: any) => g.home === abbr || g.away === abbr).slice(0, 6).map((g: any) => {
              const [hh, aa] = Array.isArray(g.final) ? g.final : [0, 0];
              const won = (g.home === abbr && hh > aa) || (g.away === abbr && aa > hh);
              return (
                <li key={g.g}>
                  <Link href={`/games/${g.g}`} className="flex items-baseline justify-between gap-2 text-[11px] hover:bg-white/[0.03] rounded px-1 py-0.5">
                    <span className="font-data text-text-secondary truncate">{g.away} {aa} @ {g.home} {hh}</span>
                    <span className={`font-data ${won ? "text-usf-green" : "text-[#e0654f]"}`}>{won ? "W" : "L"}</span>
                  </Link>
                </li>
              );
            })}
            {!(recent?.games ?? []).some((g: any) => g.home === abbr || g.away === abbr) && (
              <li className="text-[11px] text-text-dim">No recent games in the bake.</li>
            )}
          </ul>
        </div>
      </div>
      <ParkPanel parks={parks} team={abbr} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Board title="Pitchers" rows={pFiltered} cols={P_COLS} sort={q.psort ?? "rvPer100"} sortBase="psort" link={link} />
        <Board title="Hitters" rows={hFiltered} cols={H_COLS} sort={q.hsort ?? "woba"} sortBase="hsort" link={link} />
      </div>
    </div>
  );
}
