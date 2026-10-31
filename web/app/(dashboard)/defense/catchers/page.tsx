import Link from "next/link";
import { getCatcherBoard } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { compareValues } from "@/lib/table-sort";
import { PctChip, signedFixed, toneColor } from "@/components/ui/shared-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Catchers — framing, blocking, throwing" };

type Q = { season?: string; sort?: string; order?: string };

/**
 * The catcher board (docs/catcher-defense-plan.md): the three jobs side by side per season. Framing = the site's
 * §76 model (shrunk runs, Framing+); blocking = wild pitches + passed balls prevented vs our §108b expectation;
 * throwing = caught stealing above our §108a-v2 xCS (floored) with §108c throwing and deterrence runs, Savant's
 * expected CS, CS above average and throwing runs beside it, plus how often runners even try. The profile Defense tab
 * carries the splits, the dirt map, the per-pitcher tables and every attempt with a link to its video.
 */
const COLS: { key: string; label: string; nd: number; signed?: boolean; lowGood?: boolean; pct?: string; tip: string }[] = [
  { key: "framingRuns", label: "Framing runs", nd: 1, signed: true, pct: "framingPct", tip: "Site model (§76), shrunk by reliability" },
  { key: "framingPlus", label: "Framing+", nd: 0, tip: "100 = average, 10 = one SD (site model)" },
  { key: "blockAA", label: "Blocks +", nd: 1, signed: true, pct: "blockPct", tip: "WP+PB prevented vs our expected (§108b model)" },
  { key: "dirt", label: "Dirt", nd: 0, tip: "pitches in the dirt with a runner on" },
  { key: "pbwp", label: "WP+PB", nd: 0, lowGood: true, tip: "wild pitches + passed balls" },
  { key: "xcsPct", label: "xCS%", nd: 1, tip: "Site model (§108a-v2): expected caught-stealing rate on the attempts he faced, from runner speed, lead, base, pitcher hand, pickoffs and the pitcher's lead allowed" },
  { key: "csax", label: "CS + ours", nd: 1, signed: true, pct: "throwPct", tip: "caught stealing above our xCS (count)" },
  { key: "csaxPer", label: "CS+/att", nd: 3, signed: true, tip: "caught stealing above our xCS per attempt" },
  { key: "throwRuns", label: "Throw runs", nd: 1, signed: true, tip: "Site (§108c): CS above xCS in runs (base-out run expectancy) + deterrence runs" },
  { key: "deterRuns", label: "Deter runs", nd: 2, signed: true, tip: "Site (§108c): attempts below expected × the season's run value of an attempt. Passes 2020-26 only; small (about 0.2 runs sd)" },
  { key: "attBelow", label: "Att below exp", nd: 1, signed: true, tip: "Site (§108c): steal attempts expected on him minus attempts made (runner, base-out state, score, inning, pitcher lead allowed); + = runners stayed put" },
  { key: "csaa", label: "CS + Savant", nd: 1, signed: true, pct: "throwPctSav", tip: "Savant's: caught stealing above their expected CS" },
  { key: "savRuns", label: "Runs Savant", nd: 1, signed: true, tip: "Savant's catcher throwing runs" },
  { key: "att", label: "Att", nd: 0, tip: "stolen-base attempts with him catching" },
  { key: "cs", label: "CS", nd: 0, tip: "caught stealing" },
  { key: "att100", label: "Att/100", nd: 2, lowGood: true, tip: "attempts per 100 pitches with a runner on and the next base open (lower = runners stay put)" },
  { key: "pop", label: "Pop", nd: 2, lowGood: true, tip: "mean pop time on his throws, seconds" },
  { key: "arm", label: "Arm", nd: 1, tip: "mean arm strength on his throws, mph" },
  { key: "taken", label: "Taken", nd: 0, tip: "taken pitches framed" },
];

const fmt = (v: unknown, nd: number, signed?: boolean): string =>
  typeof v !== "number" || !Number.isFinite(v) ? "—" : signed ? signedFixed(v, nd) : v.toFixed(nd);

export default async function CatchersPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const board = await getCatcherBoard();
  const seasons = Object.keys(board?.seasons ?? {}).map(Number).sort((a, b) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const sortKey = COLS.find((c) => c.key === q.sort)?.key ?? "framingRuns";
  const desc = q.order !== "asc";
  const rows: any[] = [...(board?.seasons?.[String(season)] ?? [])]
    .filter((r) => (r.taken ?? 0) >= 1000 || (r.att ?? 0) >= 10)
    .sort((a, b) => compareValues(a[sortKey], b[sortKey], desc ? "desc" : "asc"));

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { season: String(season), sort: sortKey, order: desc ? "" : "asc", ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/defense/catchers?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Catchers — framing, blocking, throwing</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-border-subtle px-2 py-0.5 text-text-secondary" title="RESULTS-MLB §108a-v2 / §108c">
          xCS (ours): {board?.status?.xcs ?? "ranking confirmed pre-2020; level era-specific; 2027 confirm pending"}</span>
        <span className="rounded-md border border-border-subtle px-2 py-0.5 text-text-secondary" title="RESULTS-MLB §108c">
          Deterrence: {board?.status?.deter ?? "passes 2020-26 only, small (about 0.2 runs sd)"}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[85ch]">
        <span className="text-text-secondary">What this tells you:</span> the three parts of a catcher&apos;s defense
        side by side. <span className="text-text-secondary">Framing</span> is our model (§76): strikes won above a
        called-strike model that never saw him, in runs. <span className="text-text-secondary">Blocks +</span> is
        wild pitches and passed balls kept off the board against our model&apos;s expectation for those exact pitches (§108b, gated against Savant&apos;s: r .92).{" "}
        <span className="text-text-secondary">CS + ours</span> is runners thrown out beyond our own xCS (speed, lead,
        base, pickoffs, the pitcher&apos;s lead allowed; §108a-v2), <span className="text-text-secondary">Throw runs</span>{" "}
        prices that in runs plus <span className="text-text-secondary">deterrence</span> (attempts below expected, §108c),
        and <span className="text-text-secondary">Att/100</span> is how often they try at all. Savant&apos;s CS above average
        and throwing runs sit beside ours, labelled. Plus is good for the catcher everywhere; chips are percentiles among that season&apos;s
        catchers. Click a name for the splits, the dirt map, and every steal attempt with a link to its video.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s) => (
          <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href="/defense" className={chip(false)}>Range board</Link>
        <Link href="/framing" className={chip(false)}>Framing+</Link>
      </div>
      {!board && <div className="glass-panel p-4 text-xs text-text-dim">The catcher board has not been published yet.</div>}
      {board && <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Catcher</th>
                {COLS.map((c) => (
                  <th key={c.key} title={c.tip} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortKey ? (desc ? "descending" : "ascending") : undefined}>
                    <Link href={link({ sort: c.key, order: c.key === sortKey && desc ? "asc" : "" })} className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}{c.key === sortKey ? (desc ? " ▼" : " ▲") : ""}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-1.5 font-sans">
                    <Link prefetch={false} href={`/player/${r.id}?season=${season}&tab=defense`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span style={{ color: c.signed ? toneColor(r[c.key], false, c.nd) : undefined }}>{fmt(r[c.key], c.nd, c.signed)}</span>
                        {c.pct && typeof r[c.pct] === "number" && <PctChip p={r[c.pct]} />}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
      <p className="text-[11px] text-text-dim max-w-[85ch]">
        Sources: framing from the site&apos;s §76 model (RESULTS-MLB); blocking from Baseball Savant&apos;s
        public per-play catcher rows priced by our §108b expectation; throwing from the same rows priced by our §108a-v2 xCS
        (each attempt scored by a model that never saw its season, floored to 0.5%-99.5%), runs from the site&apos;s base-out
        run expectancy (§108c). Savant&apos;s expected CS, CS above average and throwing runs are theirs, labelled. Pitcher time
        to plate is not public; the pitcher&apos;s side of the running game (lead gained, SB/CS against our xCS) is on each
        pitcher&apos;s profile. Rows: 1,000+ taken pitches or 10+ attempts.
      </p>
    </div>
  );
}
