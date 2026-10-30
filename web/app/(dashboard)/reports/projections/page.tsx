import Link from "next/link";
import { getHitters, getPitchers } from "@/lib/data";
import { gradeColor } from "@/lib/grades";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projections" };

/**
 * Season projections (D-17): every arm and bat the site can legitimately project
 * for next season, with the intervals that travel with them. Nothing here is a
 * new model — the page composes the artifacts that already passed their gates:
 * K+ / Prevention+ (§50/§52, forecast grades), the D-36 workload bands around
 * next-season K/PA and RV/100, and the hitter Marcel (§67, wOBA/K%/BB% bands).
 * The one honest caveat that heads the page: these are skill forecasts, not
 * playing-time forecasts — "if he holds a role".
 */

const int0 = (v: number) => Math.round(v).toString();
const s2 = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
const r3 = (v: number) => v.toFixed(3).replace(/^0/, "");
const p1 = (v: number) => v.toFixed(1);
const band = (lo: unknown, hi: unknown, fmt: (v: number) => string) =>
  typeof lo === "number" && typeof hi === "number" ? <span className="text-[10px] text-text-dim font-data">[{fmt(lo)}, {fmt(hi)}]</span> : null;

export default async function ProjectionsPage({ searchParams }: {
  searchParams?: Promise<{ side?: string; team?: string }>;
}) {
  const q = (await searchParams) ?? {};
  const side = q.side === "hitters" ? "hitters" : "pitchers";
  const [prows, hrows] = await Promise.all([getPitchers(), getHitters()]);
  const season = Math.max(...prows.map((r) => Number(r.season)), ...hrows.map((r) => Number(r.season)));
  const pool = side === "pitchers" ? prows : hrows;
  const teams = [...new Set(pool.map((r) => r.team).filter((t): t is string => typeof t === "string"))].sort();
  const team = (q.team ?? "").toUpperCase();
  const rows = pool
    .filter((r) => Number(r.season) === season && (!team || r.team === team))
    .filter((r) => side === "pitchers"
      ? r.rvProj != null || r.kProj != null
      : r.wobaProj != null);
  rows.sort((a, b) =>
    side === "pitchers"
      ? (Number(b.rvProj ?? -99) - Number(a.rvProj ?? -99)) || (Number(b.kProj ?? -99) - Number(a.kProj ?? -99))
      : Number(b.wobaProj ?? -9) - Number(a.wobaProj ?? -9));
  const chip = "rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Projections for {season + 1}</h1>
          <p className="text-xs text-text-dim max-w-[90ch]">
            Skill forecasts from the {season} rows — <em>if he holds a role</em>. Nothing here forecasts playing time.
            Pitchers: Prevention+ and K+ are the site&apos;s forecast grades (RESULTS-MLB §50/§52, held-out pitchers);
            K/PA and RV/100 carry the D-36 bands — where 80% of pitchers with this workload actually landed next season.
            Hitters: Marcel (§67), last three seasons weighted 5/4/3, pulled 1,200 PA toward the league; no age or park
            term. Every number links to the full profile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[["pitchers", "Pitchers"], ["hitters", "Hitters"]].map(([k, label]) => (
            <Link key={k} href={`/reports/projections?side=${k}${team ? `&team=${team}` : ""}`}
              className={`${chip} ${side === k ? "border-usf-gold/40 text-usf-gold" : ""}`}>{label}</Link>
          ))}
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="side" value={side} />
        <select name="team" defaultValue={team} className={chip}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className={chip}>Go</button>
      </form>

      {rows.length === 0 ? (
        <div className="glass-panel p-6 text-sm text-text-dim">No projection rows for this filter.</div>
      ) : side === "pitchers" ? (
        <div className="glass-panel overflow-x-auto">
          <SortableTable key="p" className="w-full min-w-[720px] text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
                <SortTh className="px-3 py-2 text-left font-semibold">Pitcher</SortTh>
                <SortTh className="py-2 text-right font-semibold">BF</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="Prevention+ (§52): runs the arm should save next season, 100 = average, 10 = one SD. A forecast, tested on held-out pitchers.">Prev+</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="K+ (§50): projected strikeout grade. A forecast.">K+</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="Projected K per PA with the D-36 80% band.">K/PA proj</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="Projected runs saved per 100 pitches with the D-36 80% band.">RV/100 proj</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={`${r.id}-${r.season}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5">
                    <Link prefetch={false} href={`/player/${r.id}?season=${r.season}`} className="text-text-primary hover:underline">{r.name}</Link>
                    <span className="ml-1.5 text-[10px] text-text-dim">{r.team}</span>
                  </td>
                  <td className="py-1.5 text-right text-text-dim">{(r.battersFaced ?? 0).toLocaleString("en-US")}</td>
                  <td className="py-1.5 text-right font-medium" style={{ color: gradeColor(r.preventionPlus) }}>
                    {r.preventionPlus != null ? int0(r.preventionPlus) : "—"}
                  </td>
                  <td className="py-1.5 text-right" style={{ color: gradeColor(r.kPlus) }}>
                    {r.kPlus != null ? int0(r.kPlus) : "—"}
                  </td>
                  <td className="py-1.5 text-right text-text-secondary" data-sort={r.kProj ?? ""}>
                    {r.kProj != null ? r3(r.kProj) : "—"} {band(r.kProjLo, r.kProjHi, r3)}
                  </td>
                  <td className="py-1.5 text-right text-text-secondary" data-sort={r.rvProj ?? ""}>
                    {r.rvProj != null ? s2(r.rvProj) : "—"} {band(r.rvProjLo, r.rvProjHi, s2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        </div>
      ) : (
        <div className="glass-panel overflow-x-auto">
          <SortableTable key="h" className="w-full min-w-[720px] text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
                <SortTh className="px-3 py-2 text-left font-semibold">Hitter</SortTh>
                <SortTh className="py-2 text-right font-semibold">PA</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="Marcel wOBA (§67) with the 80% band, on Savant's wOBA scale.">wOBA proj</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="Marcel K% with the 80% band. Leans almost entirely on his own prior K%.">K% proj</SortTh>
                <SortTh className="py-2 text-right font-semibold" title="Marcel BB% with the 80% band.">BB% proj</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={`${r.id}-${r.season}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5">
                    <Link prefetch={false} href={`/player/${r.id}?season=${r.season}`} className="text-text-primary hover:underline">{r.name}</Link>
                    <span className="ml-1.5 text-[10px] text-text-dim">{r.team}</span>
                  </td>
                  <td className="py-1.5 text-right text-text-dim">{(r.pa ?? 0).toLocaleString("en-US")}</td>
                  <td className="py-1.5 text-right text-text-secondary" data-sort={r.wobaProj ?? ""}>
                    {r.wobaProj != null ? r3(r.wobaProj) : "—"} {band(r.wobaProjLo, r.wobaProjHi, r3)}
                  </td>
                  <td className="py-1.5 text-right text-text-secondary" data-sort={r.kPctProj ?? ""}>
                    {r.kPctProj != null ? p1(r.kPctProj) : "—"} {band(r.kPctProjLo, r.kPctProjHi, p1)}
                  </td>
                  <td className="py-1.5 text-right text-text-secondary" data-sort={r.bbPctProj ?? ""}>
                    {r.bbPctProj != null ? p1(r.bbPctProj) : "—"} {band(r.bbPctProjLo, r.bbPctProjHi, p1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-text-dim max-w-[100ch]">
        Rows need the sample their bands were measured on (pitchers 100+ batters faced for the RV band; hitters 100+ PA).
        The bands are the measured D-36/§67 out-of-sample ranges, not confidence intervals on the mean — a hitter at the
        band&apos;s top is not &quot;supposed&quot; to be there. Trades mid-season: the projection covers the whole {season} season&apos;s
        skill, not his latest club.
      </p>
    </div>
  );
}
