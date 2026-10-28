import Link from "next/link";
import { getProspectsSeason } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { logoUrl } from "@/lib/team-pixel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Prospects" };

/**
 * Prospect rankings (owner ask): MLB Pipeline's lists — Top 100, Top 30 per
 * club, Top 10 per position — for every year they publish (2011–2026),
 * re-published with mlbam ids so every row opens the player's profile.
 * Attribution is the source's own: these are Pipeline editors' rankings,
 * quoted, not ours. When the site's own prospect-value metric exists it joins
 * the same rows; until then the list carries no grade of ours.
 */

type Q = { year?: string; view?: string; team?: string; pos?: string };

const TEAM_SLUGS = ["angels", "astros", "athletics", "bluejays", "braves", "brewers", "cardinals",
  "cubs", "dbacks", "dodgers", "giants", "guardians", "mariners", "marlins", "mets", "nationals",
  "orioles", "padres", "phillies", "pirates", "rangers", "rays", "redsox", "reds", "rockies",
  "royals", "tigers", "twins", "whitesox", "yankees"];
const POS_SLUGS: [string, string][] = [["of", "OF"], ["rhp", "RHP"], ["lhp", "LHP"], ["ss", "SS"],
  ["c", "C"], ["1b", "1B"], ["2b", "2B"], ["3b", "3B"]];
const POS_LABEL: Record<string, string> = { of: "OF", rhp: "RHP", lhp: "LHP", ss: "SS", c: "C", "1b": "1B", "2b": "2B", "3b": "3B" };
const TEAM_ABBR: Record<string, string> = { angels: "LAA", astros: "HOU", athletics: "ATH", bluejays: "TOR", braves: "ATL", brewers: "MIL", cardinals: "STL", cubs: "CHC", dbacks: "AZ", dodgers: "LAD", giants: "SF", guardians: "CLE", mariners: "SEA", marlins: "MIA", mets: "NYM", nationals: "WSH", orioles: "BAL", padres: "SD", phillies: "PHI", pirates: "PIT", rangers: "TEX", rays: "TB", redsox: "BOS", reds: "CIN", rockies: "COL", royals: "KC", tigers: "DET", twins: "MIN", whitesox: "CWS", yankees: "NYY" };

const orgAbbr = (org: string | null) => org ?? "—";

function RowList({ rows, season }: { rows: any[]; season: number }) {
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-max text-xs font-data">
      <tbody>
        {rows.map((r) => {
          const crest = logoUrl(r.org);
          return (
            <tr key={`${r.id}-${r.rank}`} className="border-b border-white/[0.04]">
              <td className="px-4 py-1.5 text-right text-text-dim w-[44px]">{r.rank}</td>
              <td className="px-2 py-1.5 font-sans">
                <Link href={`/player/${r.id}?season=${season}`} className="text-text-primary hover:underline">{r.n}</Link>
              </td>
              <td className="px-2 py-1.5 text-text-secondary">{r.pos ?? "—"}</td>
              <td className="px-2 py-1.5">
                <span className="inline-flex items-center gap-1.5 text-text-secondary">
                  {crest ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={crest} alt="" width={16} height={16} className="rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : <PixelTeamLogo team={r.org} size={14} />}
                  {r.org ?? "—"}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right text-text-dim">ETA {r.eta ?? "—"}</td>
              <td className="px-2 py-1.5 text-right text-text-dim">age {r.age ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

export default async function ProspectsPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const view = q.view === "team" ? "team" : q.view === "pos" ? "pos" : "top100";
  const indexSeasons = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011];
  const year = indexSeasons.includes(Number(q.year)) ? Number(q.year) : 2026;
  const data = await getProspectsSeason(year);
  if (!data) {
    return (
      <div className="glass-panel p-8 text-center text-sm text-text-dim">
        Prospect rankings have not been baked yet (pipeline/prospects_fetch.py + web_export.py --only prospects).
      </div>
    );
  }
  const years = indexSeasons.filter((y) => y <= 2026);
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { year: String(year), view, ...q as Record<string, string>, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/prospects?${p.toString()}`;
  };

  let title = "Top 100";
  let rows: any[] = data.top100 ?? [];
  if (view === "team") {
    const slug = TEAM_SLUGS.includes(q.team ?? "") ? q.team! : "yankees";
    rows = data.teams?.[slug] ?? [];
    title = `${orgAbbr(rows[0]?.org)} top 30`;
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  if (view === "pos") {
    const slug = POS_SLUGS.some(([s]) => s === (q.pos ?? "")) ? q.pos! : "of";
    rows = data.positions?.[slug] ?? [];
    title = `Top 10 ${POS_LABEL[slug] ?? slug}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="sr-only">Prospects</h1>
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[78ch]">
        MLB Pipeline&apos;s prospect rankings — Top 100, Top 30 per club, Top 10 per position — for every year they
        publish, re-keyed to mlbam ids so each row opens the player. These are Pipeline editors&apos; rankings, quoted
        and attributed; the site adds none of its own opinion here yet.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {years.map((y) => <Link key={y} href={link({ year: String(y) })} className={chip(y === year)}>{y}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ view: "top100", team: undefined, pos: undefined })} className={chip(view === "top100")}>Top 100</Link>
        <Link href={link({ view: "team" })} className={chip(view === "team")}>By team</Link>
        <Link href={link({ view: "pos" })} className={chip(view === "pos")}>By position</Link>
      </div>
      {view === "team" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {TEAM_SLUGS.map((t) => (
            <Link key={t} href={link({ team: t })} className={chip(q.team === t)}>{TEAM_ABBR[t] ?? t}</Link>
          ))}
        </div>
      )}
      {view === "pos" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {POS_SLUGS.map(([slug, label]) => (
            <Link key={slug} href={link({ pos: slug })} className={chip(q.pos === slug)}>{label}</Link>
          ))}
        </div>
      )}
      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle flex items-center justify-between gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title} · {year}</h2>
          <span className="text-[10px] text-text-dim">MLB Pipeline, quoted</span>
        </div>
        {rows.length ? <RowList rows={rows} season={year} /> :
          <p className="px-4 py-3 text-[11px] text-text-dim">No list for this selection.</p>}
      </div>
    </div>
  );
}
