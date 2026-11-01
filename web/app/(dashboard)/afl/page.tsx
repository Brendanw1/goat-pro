import Link from "next/link";
import { getAflIndex, getAflSeason } from "@/lib/data";
import { DescriptiveChip, confidenceBadge } from "@/lib/grades";
import { Signed } from "@/components/ui/shared-ui";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";
import { armSideHb } from "@/lib/arm-slot";
import { PITCH_CONFIG } from "@/lib/constants";
import { profileHref, sampleTier, typeChanges } from "@/lib/afl";

export const dynamic = "force-dynamic";

export const metadata = { title: "Arizona Fall League" };

/**
 * Arizona Fall League (owner ask 2026-11-01): the season's pitchers, their arsenals and the hitters, from MLB
 * Stats API game feeds (pipeline/afl_fetch.py -> afl_export.py), plus each player's AFL line against his own
 * regular season (MLB/AAA Statcast for pitch-level rates, every level's box line for K%, BB%, OPS).
 * Descriptive only: a few weeks of games, no model scored on these pitches. Server-rendered; sorting is
 * client-side over the rendered rows (SortableTable).
 */

type Q = { season?: string; view?: string; min?: string };
const VIEWS = [["pitchers", "Pitchers"], ["arsenal", "Arsenal"], ["hitters", "Hitters"], ["changes", "AFL vs regular season"]] as const;
type View = (typeof VIEWS)[number][0];

const n1 = (v: unknown, dp = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(dp) : "—");
const n3 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(3).replace(/^(-?)0\./, "$1.") : "—");
const th = "px-2 py-2 text-right font-semibold";
const td = "px-2 py-1.5 text-right text-text-secondary";

function Name({ r, season }: { r: any; season: number }) {
  const href = profileHref(r, season);
  return href
    ? <Link prefetch={false} href={href} className="text-text-primary hover:underline">{r.name}</Link>
    : <span className="text-text-primary" title="no profile on the site yet">{r.name}</span>;
}

function Tier({ n }: { n: number }) {
  const b = confidenceBadge(sampleTier(n))!;
  return <span title={`${n} pitches`} className={`rounded px-1 py-px text-[9px] font-semibold ${b.bg} ${b.text}`}>{b.label}</span>;
}

/** [label, tooltip, first-click direction, left-aligned (a text column)] */
function Head({ cols }: { cols: [string, string?, ("asc" | "desc")?, boolean?][] }) {
  return (
    <thead>
      <tr className="text-[10px] uppercase tracking-wider text-text-dim">
        <SortTh first="asc" className="px-4 py-2 text-left font-semibold">Player</SortTh>
        {cols.map(([label, tip, first, left]) => <SortTh key={label} title={tip} first={first} className={left ? `${th} !text-left` : th}>{label}</SortTh>)}
      </tr>
    </thead>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-panel overflow-hidden">
      <div className="overflow-x-auto">
        <SortableTable className="w-full min-w-max text-xs font-data">{children}</SortableTable>
      </div>
    </div>
  );
}

export default async function AflPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const index = await getAflIndex();
  const seasons = (index?.seasons ?? []).map((s) => s.season);
  if (!seasons.length) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">The Fall League has not been baked yet (pipeline/afl_export.py).</div>;
  }
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const view: View = (VIEWS.map((v) => v[0]) as string[]).includes(q.view ?? "") ? (q.view as View) : "pitchers";
  const doc = await getAflSeason(season);
  const mins = view === "hitters" ? [0, 25, 50, 75] : view === "changes" ? [0, 50, 150] : [0, 50, 150, 300];
  const min = mins.includes(Number(q.min)) ? Number(q.min) : view === "hitters" ? 25 : 50;
  const unit = view === "hitters" ? "PA" : "pitches";
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams(Object.entries({ season: String(season), view, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/afl?${p.toString()}`;
  };
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  // most-seen first; every header re-sorts in the browser
  const P: any[] = (doc?.pitchers ?? []).filter((r: any) => (r.nPitches ?? 0) >= min).sort((a: any, b: any) => b.nPitches - a.nPitches);
  const H: any[] = (doc?.hitters ?? []).filter((r: any) => (view === "changes" ? r.nPitches ?? 0 : r.pa ?? 0) >= min)
    .sort((a: any, b: any) => b.pa - a.pa);
  const parks: any[] = doc?.parks ?? [];
  const spinGaps = parks.filter((p) => (p.spin ?? 0) < 0.95 && (p.tracked ?? 0) > 0.5);
  const trackedPitches = parks.reduce((s, p) => s + (p.tracked ?? 0) * (p.pitches ?? 0), 0);
  const trackedParks = parks.filter((p) => (p.tracked ?? 0) > 0.5).map((p) => p.venue);
  const thinTracking = doc?.pitches ? trackedPitches / doc.pitches < 0.5 : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-text-primary">Arizona Fall League</h1>
        <DescriptiveChip />
      </div>
      <p className="text-xs text-text-dim max-w-[75ch]">
        {season}: {doc?.games ?? 0} games, {(doc?.pitches ?? 0).toLocaleString("en-US")} pitches ({doc?.from} to {doc?.to}),
        from the MLB Stats API game feeds. Every rate is the site&apos;s own definition (glossary). A few weeks of games
        against mixed competition: read these as what a player showed, not who he is. No model is scored on Fall League
        pitches, so there is no Whiff+, K+ or Prevention+ here. The badge beside each name is the site&apos;s pitch-count
        confidence tier (HIGH 400+, MED 150+, LOW 50+, MIN below).
      </p>
      {thinTracking && (
        <p className="text-xs text-amber-400/90 max-w-[75ch]">
          In {season} pitch tracking ran only at {trackedParks.join(", ") || "no park"} ({Math.round(100 * trackedPitches / doc.pitches)}% of pitches):
          velocity, movement, spin, zone-based rates (chase, zone) and exit velocity come from those games only. Calls (CSW%, whiff%) and box lines cover every game.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map(([k, label]) => <Link key={k} href={link({ view: k })} className={chip(k === view)}>{label}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {seasons.map((s) => <Link key={s} href={link({ season: String(s), min: q.min })} className={chip(s === season)}>{s}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {mins.map((m) => <Link key={m} href={link({ min: String(m) })} className={chip(m === min)}>{m === 0 ? "All" : `${m}+ ${view === "changes" ? "pitches" : unit}`}</Link>)}
      </div>

      {view === "pitchers" && (
        <Table>
          <Head cols={[["Team"], ["G"], ["IP"], ["BF"], ["P", "pitches thrown"], ["ERA", undefined, "asc"], ["K%"], ["BB%", undefined, "asc"], ["K-BB%"],
            ["CSW%", "called + swinging strikes per pitch"], ["Whiff%", "whiffs per swing"], ["Chase%", "swings at pitches outside the zone"],
            ["Zone%"], ["FB velo", "his most-thrown fastball (four-seam or sinker), mph"], ["EV ag.", "average exit velocity allowed"], ["Mix", "usage and velocity by pitch type", undefined, true]]} />
          <tbody>
            {P.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-1.5 font-sans whitespace-nowrap"><Name r={r} season={season} /> <Tier n={r.nPitches} /></td>
                <td className="px-2 py-1.5 font-sans text-text-secondary whitespace-nowrap">{r.team}</td>
                <td className={td}>{r.g}</td><td className={td}>{n1(r.ip)}</td><td className={td}>{r.bf}</td><td className={td}>{r.nPitches}</td>
                <td className={td}>{n1(r.era, 2)}</td><td className={td}>{n1(r.kPct)}</td><td className={td}>{n1(r.bbPct)}</td><td className={td}>{n1(r.kBbPct)}</td>
                <td className={td}>{n1(r.cswPct)}</td><td className={td}>{n1(r.whiffPct)}</td><td className={td}>{n1(r.chasePct)}</td><td className={td}>{n1(r.zonePct)}</td>
                <td className={td}>{n1(r.fbVelo)}</td><td className={td}>{n1(r.evAg)}</td>
                <td className="px-2 py-1.5 text-left text-text-dim whitespace-nowrap" data-sort={r.arsenal?.length ?? 0}>
                  {(r.arsenal ?? []).filter((a: any) => a.n >= 10).map((a: any) => (
                    <span key={a.type} className="mr-2" style={{ color: (PITCH_CONFIG as any)[a.type]?.color }}>{a.type} {n1(a.usage, 0)}% {n1(a.velo)}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {view === "arsenal" && (
        <Table>
          <Head cols={[["Type"], ["N", "pitches of this type"], ["Use%"], ["Velo"], ["IVB", "induced vertical break, inches"], ["HB", "horizontal break, inches, arm-side positive"],
            ["Spin", "rpm; blank where spin was tracked on under half his pitches of the type (see park coverage below)"], ["Ext", "extension, ft"],
            ["Whiff%"], ["CSW%"], ["Chase%"]]} />
          <tbody>
            {P.flatMap((r) => (r.arsenal ?? []).filter((a: any) => a.n >= 10).map((a: any) => (
              <tr key={`${r.id}-${a.type}`} className="border-t border-white/[0.04]">
                <td className="px-4 py-1.5 font-sans whitespace-nowrap"><Name r={r} season={season} /> <span className="text-text-dim">{r.throws}HP</span></td>
                <td className="px-2 py-1.5 text-right font-semibold" style={{ color: (PITCH_CONFIG as any)[a.type]?.color }}>{a.type}</td>
                <td className={td}>{a.n}</td><td className={td}>{n1(a.usage)}</td><td className={td}>{n1(a.velo)}</td>
                <td className={td}>{n1(a.ivb)}</td><td className={td}>{n1(armSideHb(a.hb, r.throws))}</td>
                <td className={td} title={`spin tracked on ${Math.round(100 * (a.spinCover ?? 0))}% of these pitches`}>{n1(a.spin, 0)}</td>
                <td className={td}>{n1(a.ext)}</td><td className={td}>{n1(a.whiffPct)}</td><td className={td}>{n1(a.cswPct)}</td><td className={td}>{n1(a.chasePct)}</td>
              </tr>
            )))}
          </tbody>
        </Table>
      )}

      {view === "hitters" && (
        <Table>
          <Head cols={[["Team"], ["G"], ["PA"], ["AVG"], ["OBP"], ["SLG"], ["OPS"], ["HR"], ["K%", undefined, "asc"], ["BB%"],
            ["BIP", "tracked balls in play"], ["EV", "average exit velocity"], ["EV90", "90th-percentile exit velocity"], ["Max EV"],
            ["HH%", "hard-hit: 95+ mph, per ball in play"], ["Brl%", "barrels per ball in play (Savant's rule)"],
            ["Whiff%", "whiffs per swing", "asc"], ["Chase%", "swings at pitches outside the zone", "asc"]]} />
          <tbody>
            {H.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-1.5 font-sans whitespace-nowrap"><Name r={r} season={season} /> <Tier n={r.nPitches} /></td>
                <td className="px-2 py-1.5 font-sans text-text-secondary whitespace-nowrap">{r.team}</td>
                <td className={td}>{r.g}</td><td className={td}>{r.pa}</td>
                <td className={td}>{n3(r.avg)}</td><td className={td}>{n3(r.obp)}</td><td className={td}>{n3(r.slg)}</td><td className={td}>{n3(r.ops)}</td>
                <td className={td}>{r.hr}</td><td className={td}>{n1(r.kPct)}</td><td className={td}>{n1(r.bbPct)}</td><td className={td}>{r.bip}</td>
                <td className={td}>{n1(r.ev)}</td><td className={td}>{n1(r.ev90)}</td><td className={td}>{n1(r.maxEv)}</td>
                <td className={td}>{n1(r.hardHitPct)}</td><td className={td}>{n1(r.barrelPct)}</td><td className={td}>{n1(r.whiffPct)}</td><td className={td}>{n1(r.chasePct)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {view === "changes" && (
        <>
          <p className="text-xs text-text-dim max-w-[75ch]">
            AFL minus his own {season} regular season. K% and BB% (and OPS for hitters) compare against his box lines at every level
            that year; velocity, movement, usage, whiff, chase and CSW compare against his tracked MLB and Triple-A pitches (100+
            needed; levels below Triple-A have no tracking). Green is better for the player, red worse. The Fall League parks run
            spring-training tracking, a different system from the regular-season parks, so a small shift can be the system and not
            the player. A <em>new pitch</em> is 5%+ of his AFL pitches after under 1% in the regular season.
          </p>
          <h2 className="text-sm font-semibold text-text-primary">Pitchers</h2>
          <Table>
            <Head cols={[["2026 levels", "regular-season levels (box lines)"], ["P", "AFL pitches"], ["Reg P", "tracked regular-season pitches (MLB/AAA)"],
              ["ΔFB velo", "most-thrown fastball, mph"], ["ΔK%"], ["ΔBB%", undefined, "asc"], ["ΔWhiff%"], ["ΔChase%"], ["ΔCSW%"], ["New pitch"], ["Pitch changes", "per type, AFL minus regular season; shown past 0.5 mph, 5 points of usage or 1.5 in. of break", undefined, true]]} />
            <tbody>
              {P.filter((r) => r.delta).map((r) => {
                const d = r.delta;
                return (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 font-sans whitespace-nowrap"><Name r={r} season={season} /> <Tier n={r.nPitches} /></td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary whitespace-nowrap" title={d.regTeam}>{d.levels ?? "—"}</td>
                    <td className={td}>{r.nPitches}</td><td className={td}>{d.regTracked ?? "—"}</td>
                    <td className={td}><Signed v={d.dFbVelo} dp={1} /></td>
                    <td className={td}><Signed v={d.dKPct} dp={1} /></td><td className={td}><Signed v={d.dBbPct} dp={1} lowerIsGood /></td>
                    <td className={td}><Signed v={d.dWhiffPct} dp={1} /></td><td className={td}><Signed v={d.dChasePct} dp={1} /></td>
                    <td className={td}><Signed v={d.dCswPct} dp={1} /></td>
                    <td className="px-2 py-1.5 text-right font-sans text-text-primary">{(d.newPitches ?? []).join(", ") || "—"}</td>
                    <td className="px-2 py-1.5 text-left font-sans text-text-dim whitespace-nowrap">{typeChanges(d.types, r.throws).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <h2 className="text-sm font-semibold text-text-primary">Hitters</h2>
          <Table>
            <Head cols={[["2026 levels"], ["PA"], ["Reg PA", "regular-season PA, every level"], ["ΔOPS"], ["ΔK%", undefined, "asc"], ["ΔBB%"],
              ["ΔEV", "average exit velocity vs his tracked MLB/AAA balls in play"], ["ΔHH%"], ["ΔWhiff%", undefined, "asc"], ["ΔChase%", undefined, "asc"]]} />
            <tbody>
              {H.filter((r) => r.delta).map((r) => {
                const d = r.delta;
                return (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 font-sans whitespace-nowrap"><Name r={r} season={season} /> <Tier n={r.nPitches} /></td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary whitespace-nowrap" title={d.regTeam}>{d.levels ?? "—"}</td>
                    <td className={td}>{r.pa}</td><td className={td}>{d.regPa ?? "—"}</td>
                    <td className={td}><Signed v={d.dOps} dp={3} /></td>
                    <td className={td}><Signed v={d.dKPct} dp={1} lowerIsGood /></td><td className={td}><Signed v={d.dBbPct} dp={1} /></td>
                    <td className={td}><Signed v={d.dEv} dp={1} /></td><td className={td}><Signed v={d.dHardHitPct} dp={1} /></td>
                    <td className={td}><Signed v={d.dWhiffPct} dp={1} lowerIsGood /></td><td className={td}><Signed v={d.dChasePct} dp={1} lowerIsGood /></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      <div className="text-[11px] text-text-dim">
        {view === "hitters" ? H.length : view === "arsenal" ? P.reduce((s, r) => s + (r.arsenal ?? []).filter((a: any) => a.n >= 10).length, 0) : view === "changes" ? `${P.filter((r) => r.delta).length} pitchers, ${H.filter((r) => r.delta).length} hitters with a regular season to compare` : P.length}
        {view === "hitters" ? " hitters" : view === "arsenal" ? " pitch types (10+ pitches)" : view === "changes" ? "" : " pitchers"}
      </div>

      <details className="glass-panel p-3 text-[11px] text-text-dim">
        <summary className="cursor-pointer select-none text-text-secondary">Tracking coverage by park ({season})</summary>
        <table className="mt-2 text-[11px] font-data">
          <thead><tr className="text-text-dim"><th className="pr-4 text-left">Park</th><th className="pr-3 text-right">Games</th><th className="pr-3 text-right">Pitches</th><th className="pr-3 text-right">Tracked</th><th className="pr-3 text-right">Spin</th><th className="text-right">Extension</th></tr></thead>
          <tbody>
            {parks.map((p) => (
              <tr key={p.venue}><td className="pr-4 font-sans text-text-secondary">{p.venue}</td><td className="pr-3 text-right">{p.games}</td><td className="pr-3 text-right">{p.pitches}</td>
                <td className="pr-3 text-right">{n1(100 * p.tracked, 0)}%</td><td className="pr-3 text-right">{n1(100 * p.spin, 0)}%</td><td className="text-right">{n1(100 * p.ext, 0)}%</td></tr>
            ))}
          </tbody>
        </table>
        {spinGaps.length > 0 && <p className="mt-2">Spin is missing on part of the slate at {spinGaps.map((p) => p.venue).join(", ")}; a pitch type&apos;s spin shows only where it was tracked on at least half its pitches. Untracked pitches still count toward calls, CSW% and whiff%.</p>}
      </details>
    </div>
  );
}
