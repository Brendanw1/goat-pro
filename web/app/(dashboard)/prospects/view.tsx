import Link from "next/link";
import { getProspectValue, getProspectsSeason, getDraftHitRates, getFarmOutput } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { logoUrl } from "@/lib/team-pixel";
import { sortComparator } from "@/lib/table-sort";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";


export const metadata = { title: "Prospects" };

/**
 * Prospect rankings (owner ask): MLB Pipeline's lists — Top 100, Top 30 per
 * club, Top 10 per position — for every year they publish (2011–2026),
 * re-published with mlbam ids so every row opens the player's profile.
 * Attribution is the source's own: these are Pipeline editors' rankings,
 * quoted, not ours. When the site's own prospect-value metric exists it joins
 * the same rows; until then the list carries no grade of ours.
 */

type Q = { year?: string; view?: string; team?: string; pos?: string; riser?: string; fy?: string; fsort?: string; forder?: string };

const TEAM_SLUGS = ["angels", "astros", "athletics", "bluejays", "braves", "brewers", "cardinals",
  "cubs", "dbacks", "dodgers", "giants", "guardians", "mariners", "marlins", "mets", "nationals",
  "orioles", "padres", "phillies", "pirates", "rangers", "rays", "redsox", "reds", "rockies",
  "royals", "tigers", "twins", "whitesox", "yankees"];
const POS_SLUGS: [string, string][] = [["of", "OF"], ["rhp", "RHP"], ["lhp", "LHP"], ["ss", "SS"],
  ["c", "C"], ["1b", "1B"], ["2b", "2B"], ["3b", "3B"]];
const POS_LABEL: Record<string, string> = { of: "OF", rhp: "RHP", lhp: "LHP", ss: "SS", c: "C", "1b": "1B", "2b": "2B", "3b": "3B" };
const TEAM_ABBR: Record<string, string> = { angels: "LAA", astros: "HOU", athletics: "ATH", bluejays: "TOR", braves: "ATL", brewers: "MIL", cardinals: "STL", cubs: "CHC", dbacks: "AZ", dodgers: "LAD", giants: "SF", guardians: "CLE", mariners: "SEA", marlins: "MIA", mets: "NYM", nationals: "WSH", orioles: "BAL", padres: "SD", phillies: "PHI", pirates: "PIT", rangers: "TEX", rays: "TB", redsox: "BOS", reds: "CIN", rockies: "COL", royals: "KC", tigers: "DET", twins: "MIN", whitesox: "CWS", yankees: "NYY" };

function RowList({ rows, season }: { rows: any[]; season: number }) {
  return (
    <div className="overflow-x-auto"><SortableTable className="w-full min-w-max text-xs font-data">
      <thead>
        <tr className="text-[9px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
          <SortTh first="asc" className="px-4 py-1.5 text-right font-semibold">Rank</SortTh>
          <SortTh className="px-2 py-1.5 text-left font-semibold">Player</SortTh>
          <SortTh className="px-2 py-1.5 text-left font-semibold">Pos</SortTh>
          <SortTh className="px-2 py-1.5 text-left font-semibold">Org</SortTh>
          <SortTh first="asc" className="px-2 py-1.5 text-right font-semibold">ETA</SortTh>
          <SortTh first="asc" className="px-2 py-1.5 text-right font-semibold">Age</SortTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const crest = logoUrl(r.org);
          return (
            <tr key={`${r.id}-${r.rank}`} className="border-b border-white/[0.04]">
              <td className="px-4 py-1.5 text-right text-text-dim w-[44px]">{r.rank}</td>
              <td className="px-2 py-1.5 font-sans">
                <Link prefetch={false} href={`/player/${r.id}?season=${season}`} className="text-text-primary hover:underline">{r.n}</Link>
                    {r.debut ? <span className="ml-1.5 rounded bg-white/[0.06] px-1 py-0.5 text-[9px] font-data text-text-dim" title={`MLB debut ${r.debut}`}>MLB</span> : null}
              </td>
              <td className="px-2 py-1.5 text-text-secondary">{r.pos ?? "—"}</td>
              <td className="px-2 py-1.5">
                <span className="inline-flex items-center gap-1.5 text-text-secondary">
                  {crest ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={crest} alt="" width={16} height={16} className="rounded" />
                  ) : <PixelTeamLogo team={r.org} size={14} />}
                  {r.org ?? "—"}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right text-text-dim" data-sort={r.eta ?? ""}>ETA {r.eta ?? "—"}</td>
              <td className="px-2 py-1.5 text-right text-text-dim" data-sort={r.age ?? ""}>age {r.age ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </SortableTable></div>
  );
}

export default async function ProspectsPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const view = q.view === "team" ? "team" : q.view === "pos" ? "pos" : q.view === "hitrate" ? "hitrate" : q.view === "farm" ? "farm" : q.view === "value" ? "value" : "top100";
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
  const team = TEAM_SLUGS.includes(q.team ?? "") ? q.team! : "yankees";
  const pos = POS_SLUGS.some(([s]) => s === (q.pos ?? "")) ? q.pos! : "of";
  let rows: any[] = data.top100 ?? [];
  if (view === "value") {
    const pv = await getProspectValue();
    if (!pv) return <div className="glass-panel p-8 text-sm text-text-dim">Value table not baked yet.</div>;
    const table = (side: "batters" | "pitchers") => (
      <table className="w-full min-w-[560px] text-xs font-data">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
            <th className="px-3 py-2 text-left font-semibold">Rank at his best</th>
            <th className="py-2 text-right font-semibold">N</th>
            <th className="py-2 text-right font-semibold" title="Share appearing in the majors within the 2020-24 window">Reach</th>
            <th className="py-2 text-right font-semibold" title="Mean §85 WAR over his first three seasons after listing (complete for every cohort)">WAR 3y</th>
            <th className="py-2 text-right font-semibold" title="Median — half of every tier returns nothing in three years">med</th>
            <th className="py-2 text-right font-semibold" title="Share with ≥1 WAR over the first three seasons">≥1 WAR</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(pv[side] as Record<string, any>).map(([tier, v]: [string, any]) => (
            <tr key={tier} className="border-t border-white/[0.04]">
              <td className="px-3 py-1.5 text-text-primary">{tier}</td>
              <td className="py-1.5 text-right text-text-dim">{v.n}</td>
              <td className="py-1.5 text-right text-text-secondary">{Math.round(100 * v.reached_mlb)}%</td>
              <td className="py-1.5 text-right text-text-primary font-medium">{v.war_3y.toFixed(2)}</td>
              <td className="py-1.5 text-right text-text-dim">{v.war_3y_med.toFixed(2)}</td>
              <td className="py-1.5 text-right text-text-secondary">{Math.round(100 * v.ge1war_3y)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Prospects — what a rank returns</h1>
        <p className="text-xs text-text-dim max-w-[85ch]">
          What each top-100 tier actually returned: Pipeline cohorts 2016–2021 valued in the site&apos;s own WAR
          (§85), by seasons after listing. The three-year column is complete for every cohort; later columns
          under-count recent classes. <span className="text-text-secondary">The medians are zero at every tier —
          half of every tier returns nothing in three years; the top-10 batter slot is the only reliably valuable
          one (1.22 WAR/3y at an 85% reach rate), while top-10 pitchers return barely more than the 26–50 tier.</span>
          Descriptive: Pipeline&apos;s rankings plus our WAR (§106).
        </p>
        <div className="glass-panel overflow-x-auto">
          <div className="px-4 py-2 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">Batters</div>
          {table("batters")}
        </div>
        <div className="glass-panel overflow-x-auto">
          <div className="px-4 py-2 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">Pitchers</div>
          {table("pitchers")}
        </div>
      </div>
    );
  }
  if (view === "hitrate") {
    const hr = await getDraftHitRates();
    const fmtP = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Prospects — hit rates</h1>
        <p className="text-xs text-text-dim max-w-[85ch]">
          Sixteen years of Pipeline lists and drafts joined to MLB debuts — a descriptive read of what a ranking is
          worth. Each list-year counts separately (list quality, not player counting); time-to-MLB counts only debuts
          after the list year. All from public sources: Pipeline&apos;s published ranks, the statsapi draft and debut dates.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link({ view: "top100" })} className={chip(false)}>Top 100</Link>
          <Link href={link({ view: "team" })} className={chip(false)}>By team</Link>
          <Link href={link({ view: "pos" })} className={chip(false)}>By position</Link>
          <Link href={link({ view: "hitrate" })} className={chip(false)}>Hit rates</Link>
          <Link href={link({ view: "value" })} className={chip(false)}>What a rank returns</Link>
          <Link href={link({ view: "value" })} className={chip(true)}>What a rank returns</Link>
        </div>
        <div className="glass-panel p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            Pipeline top-100 rank slot → reached MLB (2011–2026 lists)
          </h2>
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="py-1 text-left font-semibold">Rank slot</th>
                <th className="py-1 text-right font-semibold">List slots</th>
                <th className="py-1 text-right font-semibold">Reached MLB</th>
                <th className="py-1 text-right font-semibold">Share</th>
                <th className="py-1 text-right font-semibold">Median years to MLB</th>
              </tr>
            </thead>
            <tbody>
              {(hr?.rankBuckets ?? []).map((r: any) => (
                <tr key={r.bucket} className="border-t border-white/[0.04]">
                  <td className="py-1 font-sans text-text-secondary">{r.bucket}</td>
                  <td className="py-1 text-right text-text-dim">{r.n?.toLocaleString()}</td>
                  <td className="py-1 text-right text-text-secondary">{r.reached?.toLocaleString()}</td>
                  <td className="py-1 text-right text-text-primary">{fmtP(r.pct)}</td>
                  <td className="py-1 text-right text-text-secondary">{r.medianYearsToMlb ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="glass-panel p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            Draft round → reached MLB (2011–2026 drafts)
          </h2>
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="py-1 text-left font-semibold">Round</th>
                <th className="py-1 text-right font-semibold">Picks (with ids)</th>
                <th className="py-1 text-right font-semibold">Reached MLB</th>
                <th className="py-1 text-right font-semibold">Share</th>
              </tr>
            </thead>
            <tbody>
              {(hr?.draftRounds ?? []).map((r: any) => (
                <tr key={r.bucket} className="border-t border-white/[0.04]">
                  <td className="py-1 font-sans text-text-secondary">{r.bucket}</td>
                  <td className="py-1 text-right text-text-dim">{r.n?.toLocaleString()}</td>
                  <td className="py-1 text-right text-text-secondary">{r.reached?.toLocaleString()}</td>
                  <td className="py-1 text-right text-text-primary">{fmtP(r.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(hr?.rankByYear ?? []).length > 0 && (
          <div className="glass-panel p-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
              Top-100 list quality by year — share of the list that reached MLB
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {(hr?.rankByYear ?? []).map((r: any) => (
                <Link key={r.year} href={link({ view: "top100", year: String(r.year) })}
                  title={`${r.year}: ${r.n} ranked`}
                  className="px-2 py-1 rounded border border-border-subtle text-[10px] font-data hover:bg-white/[0.04]"
                  style={{ color: `hsl(${Math.round(120 * Math.min(1, Number(r.reachedPct ?? 0) / 100))} 45% 60%)` }}>
                  {r.year} · {fmtP(r.reachedPct)}
                </Link>
              ))}
            </div>
            <p className="text-[10px] text-text-dim mt-2">
              Recent years read low by construction — their lists are still maturing. The colour runs green as the
              class reaches the majors.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (view === "farm") {
    const farm = await getFarmOutput();
    const years = Object.keys(farm?.risers ?? {}).map(Number).sort((a, b) => b - a);
    // fy: "" = the pooled matured 2011-19 table, else one list year (its own league line)
    const farmYears = Object.keys(farm?.byYear ?? {}).map(Number).sort((a, b) => b - a);
    const fy = farmYears.includes(Number(q.fy)) ? Number(q.fy) : null;
    const yearDoc = fy ? farm?.byYear?.[String(fy)] : null;
    const riseYear = fy && years.includes(fy) ? fy : years.includes(Number(q.riser)) ? Number(q.riser) : years[0];
    const fsort = ["slots", "top100", "reached", "reachedPct", "vsLeague", "outputIndex", "mlb"].includes(q.fsort ?? "") ? q.fsort! : "outputIndex";
    const forder = q.forder === "asc" ? "asc" : "desc";
    const orgRows = [...((yearDoc ? yearDoc.orgs : farm?.orgs) ?? [])]
      .map((o: any) => ({ ...o, mlb: (o.mlbPa ?? 0) + (o.mlbBf ?? 0) }))
      .sort(sortComparator(fsort, forder));
    const lgPct = yearDoc ? yearDoc.leagueReachedPct : farm?.leagueReachedPct;
    const fcols: [string, string][] = [["slots", "List slots"], ["top100", "Top-100 entries"], ["reached", "Reached MLB"],
      ["reachedPct", "Reach%"], ["vsLeague", "vs league"], ["outputIndex", "Output index"], ["mlb", "MLB PA+BF"]];
    const crest = (tm: string | null) => logoUrl(tm);
    const moveRow = (r: any, i: number, up: boolean) => (
      <div key={i} className="flex items-baseline gap-2 text-[11px] border-b border-white/[0.03] py-1">
        <span className="font-data shrink-0 w-[92px]" style={{ color: up ? "#5ba88f" : "#e0654f" }}>#{r.from} → #{r.to}</span>
        <Link prefetch={false} href={`/player/${r.id}`} className="font-sans text-text-primary hover:underline flex-1 truncate">{r.name ?? r.id}</Link>
        {r.debut ? <span className="text-[10px] text-text-dim shrink-0">MLB {r.debut}</span> : null}
      </div>
    );
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Prospects — farm output</h1>
        <p className="text-xs text-text-dim max-w-[85ch]">
          What each organization&apos;s farm produced. The default table pools the matured 2011-2019 lists (the debut
          window has closed); pick a year for that year&apos;s team lists alone. Reach% is the org&apos;s own slots that
          reached the majors; vs-league reads it against the league&apos;s {lgPct ?? "—"}% on the same list
          {fy ? " year" : "s"}. The output index weights each graduate by the tier he was ranked in (top 10 = 4, 11-25 = 3,
          26-50 = 2, 51-100 = 1, unranked = 0.5); MLB PA+BF is the playing time the farm&apos;s alumni actually produced
          (2020-26 Statcast). Descriptive joins of public sources.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link({ view: "top100" })} className={chip(false)}>Top 100</Link>
          <Link href={link({ view: "team" })} className={chip(false)}>By team</Link>
          <Link href={link({ view: "pos" })} className={chip(false)}>By position</Link>
          <Link href={link({ view: "hitrate" })} className={chip(false)}>Hit rates</Link>
          <Link href={link({ view: "value" })} className={chip(false)}>What a rank returns</Link>
          <Link href={link({ view: "farm" })} className={chip(true)}>Farm output</Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={link({ fy: undefined })} className={chip(fy === null)}>2011–19 pooled</Link>
          <span className="w-px h-4 bg-border-subtle mx-1" />
          {farmYears.map((y) => <Link key={y} href={link({ fy: String(y) })} className={chip(y === fy)}>{y}</Link>)}
        </div>
        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
              Farm-system output — {fy ? `${fy} team lists` : "2011-2019 lists"}
            </h2>
            {yearDoc && !yearDoc.matured && (
              <span className="text-[10px] text-text-dim">Still maturing: reach reads low for every org alike, so compare orgs with vs league.</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs font-data">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="pl-4 pr-1 py-2 text-right font-semibold">#</th>
                  <th className="px-2 py-2 text-left font-semibold">Org</th>
                  {fcols.map(([k, l]) => (
                    <th key={k} className="px-2 py-2 text-right font-semibold" aria-sort={k === fsort ? (forder === "desc" ? "descending" : "ascending") : undefined}>
                      <Link href={link({ fsort: k, forder: k === fsort && forder === "desc" ? "asc" : "desc" })}
                        className={k === fsort ? "text-text-primary" : "hover:text-text-secondary"}>
                        {l}{k === fsort ? (forder === "desc" ? " ▼" : " ▲") : ""}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgRows.map((o: any, i: number) => (
                  <tr key={o.org} className="border-t border-white/[0.04]">
                    <td className="pl-4 pr-1 py-1.5 text-right text-text-dim">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5 font-sans text-text-secondary">
                        {crest(o.org) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={crest(o.org)!} alt="" width={14} height={14} className="rounded" />
                        ) : <PixelTeamLogo team={o.org} size={13} />}
                        {o.org}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-text-dim">{o.slots}</td>
                    <td className="px-2 py-1.5 text-right text-text-dim">{o.top100}</td>
                    <td className="px-2 py-1.5 text-right text-text-secondary">{o.reached}</td>
                    <td className="px-2 py-1.5 text-right text-text-primary">{o.reachedPct}%</td>
                    <td className="px-2 py-1.5 text-right" style={{ color: Number(o.vsLeague) >= 0 ? "#5ba88f" : "#e0654f" }}>
                      {Number(o.vsLeague) > 0 ? "+" : ""}{o.vsLeague}
                    </td>
                    <td className="px-2 py-1.5 text-right text-text-primary">{o.outputIndex}</td>
                    <td className="px-2 py-1.5 text-right text-text-dim">{o.mlb.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass-panel p-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Time to the majors — cumulative % debuted by years since first top-100 list</h2>
            <table className="w-full text-xs font-data">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                  <th className="py-1 text-left font-semibold">Tier</th>
                  {[0, 1, 2, 3, 4, 5, "6+"].map((k) => (
                    <th key={String(k)} className="py-1 text-right font-semibold">{k === "6+" ? "6+" : `+${k}`} yr</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(farm?.tierCurves ?? []).map((c: any) => (
                  <tr key={c.tier} className="border-t border-white/[0.04]">
                    <td className="py-1 font-sans text-text-secondary">{c.tier}</td>
                    {c.cumPct.map((v: any, i: number) => (
                      <td key={i} className={`py-1 text-right ${i === 2 ? "text-text-primary" : "text-text-secondary"}`}>{v}%</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-text-dim mt-2">Matured 2011-2019 first appearances; the +2 column highlighted — that is the tier&apos;s two-year graduation rate.</p>
          </div>
          <div className="glass-panel p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Risers and fallers — {riseYear} vs {riseYear - 1} top 100</h2>
            </div>
            {!fy && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {years.map((y: number) => (
                  <Link key={y} href={link({ riser: String(y) })} className={chip(y === riseYear)}>{y}</Link>
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-text-dim mb-1">Risers</div>
                {((farm?.risers ?? {})[String(riseYear)]?.up ?? []).map((r: any, i: number) => moveRow(r, i, true))}
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-text-dim mb-1">Fallers (stayed on the list)</div>
                {((farm?.risers ?? {})[String(riseYear)]?.down ?? []).map((r: any, i: number) => moveRow(r, i, false))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "team") {
    // Rows carry each player's CURRENT org (Pipeline archive quirk), so the title comes from the list's own club.
    rows = data.teams?.[team] ?? [];
    title = `${TEAM_ABBR[team]} top 30`;
  }
  if (view === "pos") {
    rows = data.positions?.[pos] ?? [];
    title = `Top 10 ${POS_LABEL[pos]}`;
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
          <Link href={link({ view: "hitrate" })} className={chip(false)}>Hit rates</Link>
          <Link href={link({ view: "value" })} className={chip(false)}>What a rank returns</Link>
          <Link href={link({ view: "farm" })} className={chip(false)}>Farm output</Link>
      </div>
      {view === "team" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {TEAM_SLUGS.map((t) => (
            <Link key={t} href={link({ team: t })} className={chip(team === t)}>{TEAM_ABBR[t] ?? t}</Link>
          ))}
        </div>
      )}
      {view === "pos" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {POS_SLUGS.map(([slug, label]) => (
            <Link key={slug} href={link({ pos: slug })} className={chip(pos === slug)}>{label}</Link>
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
