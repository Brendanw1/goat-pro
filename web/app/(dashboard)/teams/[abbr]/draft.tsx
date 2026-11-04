import Link from "next/link";
import { getOrgDraft } from "@/lib/data";
import { Signed } from "@/components/ui/shared-ui";

/**
 * Draft tab: every 2011-26 pick by the club (orgs/{abbr}/draft.json): school type (never the school, AGENTS rule 1),
 * bonus vs slot, highest level, MLB debut, line WAR to date, latest club. Reach rates by pick band vs the league on the
 * matured 2011-19 classes. Descriptive.
 */

const TYPE: Record<string, string> = { HS: "HS", "4YR": "4-year", JC: "JC" };
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const money = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`);

export default async function DraftTab({ abbr, dy, link }: { abbr: string; dy?: string; link: (o: Record<string, string | undefined>) => string }) {
  const d = await getOrgDraft(abbr);
  if (!d) return <div className="glass-panel p-6 text-sm text-text-dim">No draft file for {abbr}.</div>;
  const years: number[] = [...d.classes].sort((a: number, b: number) => b - a);
  const year = years.includes(Number(dy)) ? Number(dy) : null;
  const picks: any[] = year ? d.picks.filter((p: any) => p.year === year)
    : [...d.picks].filter((p: any) => p.war != null).sort((a: any, b: any) => b.war - a.war).slice(0, 30);
  const chip = (on: boolean) =>
    `px-2 py-0.5 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const diff = (c?: number | null, l?: number | null) => (c == null || l == null ? null : 100 * (c - l));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,300px)]">
        <div className="glass-panel p-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Reach rates by pick, {d.matured} classes ({abbr} vs league)</h2>
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="py-1 text-left font-semibold">Overall pick</th>
                <th className="py-1 text-right font-semibold">Picks</th>
                {["AA", "AAA", "MLB"].map((k) => <th key={k} className="py-1 text-right font-semibold">{k}+ (lg)</th>)}
                <th className="py-1 text-right font-semibold" title="MLB reach minus the league's, percentage points">MLB vs lg</th>
              </tr>
            </thead>
            <tbody>
              {d.rates.map((r: any) => (
                <tr key={r.band} className="border-t border-white/[0.04]">
                  <td className="py-1 text-text-secondary">{r.band}</td>
                  <td className="py-1 text-right text-text-dim">{r.n}</td>
                  {(["aa", "aaa", "mlb"] as const).map((k) => (
                    <td key={k} className="py-1 text-right text-text-secondary">{pct(r[k])} <span className="text-text-dim">({pct(r[`lg_${k}`])})</span></td>
                  ))}
                  <td className="py-1 text-right"><Signed v={diff(r.mlb, r.lg_mlb)} dp={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-text-dim">
            Share of the club&apos;s picks whose highest level reached each mark (MLB = any MLB season with a line). A pick who
            didn&apos;t sign and was drafted again counts for the later club. Small bands swing on a few players.
          </p>
        </div>
        <div className="glass-panel p-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Picks by school type, 2011–26</h2>
          <table className="w-full text-xs font-data">
            <tbody>
              {Object.keys(TYPE).map((k) => (
                <tr key={k} className="border-t border-white/[0.04]">
                  <td className="py-1 text-text-secondary">{TYPE[k]}</td>
                  <td className="py-1 text-right text-text-primary">{pct(d.cls[k])}</td>
                  <td className="py-1 text-right text-text-dim">lg {pct(d.lgCls[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-text-dim">From the draft feed&apos;s class where listed, else the listed school&apos;s type. The school itself is not shown.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={link({ dy: undefined })} className={chip(!year)}>Best by WAR</Link>
        {years.map((y) => <Link key={y} href={link({ dy: String(y) })} className={chip(y === year)}>{y}</Link>)}
      </div>

      <div className="glass-panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
              {!year && <th className="px-3 py-1.5 font-semibold">Class</th>}
              <th className="px-3 py-1.5 font-semibold text-right">Pick</th>
              <th className="px-3 py-1.5 font-semibold">Rd</th>
              <th className="px-3 py-1.5 font-semibold">Player</th>
              <th className="px-3 py-1.5 font-semibold">Type</th>
              <th className="px-3 py-1.5 font-semibold text-right">Bonus</th>
              <th className="px-3 py-1.5 font-semibold text-right" title="Bonus minus the pick's slot value (rounds 1-10; blank where the feed lists no slot)">vs slot</th>
              <th className="px-3 py-1.5 font-semibold">Highest</th>
              <th className="px-3 py-1.5 font-semibold text-right">Debut</th>
              <th className="px-3 py-1.5 font-semibold text-right" title="Line WAR to date (§85 accounting from public season lines), descriptive">WAR</th>
              <th className="px-3 py-1.5 font-semibold">Latest</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <tr key={`${p.year}-${p.pick}`} className="border-t border-border-subtle/50">
                {!year && <td className="px-3 py-1 font-data text-text-dim">{p.year}</td>}
                <td className="px-3 py-1 text-right font-data text-text-dim">{p.pick}</td>
                <td className="px-3 py-1 font-data text-text-dim">{p.round}</td>
                <td className="px-3 py-1">
                  <Link prefetch={false} href={p.debut ? `/player/${p.id}` : `/minors/player/${p.id}`} className="text-text-primary hover:underline">{p.name}</Link>
                </td>
                <td className="px-3 py-1 text-[11px] text-text-dim">{p.cls ? TYPE[p.cls] : "—"}</td>
                <td className="px-3 py-1 text-right font-data text-text-secondary">{money(p.bonus)}</td>
                <td className="px-3 py-1 text-right font-data text-[11px]">{p.bonus != null && p.slot ? <Signed v={(p.bonus - p.slot) / 1e3} dp={0} /> : ""}</td>
                <td className="px-3 py-1 font-data text-text-secondary">{p.redrafted ? <span className="text-[10px] text-text-dim">redrafted {p.redrafted}</span> : p.hi ?? <span className="text-text-dim">did not play</span>}</td>
                <td className="px-3 py-1 text-right font-data text-text-dim">{p.debut ?? ""}</td>
                <td className="px-3 py-1 text-right">{p.war != null ? <Signed v={p.war} dp={1} /> : ""}</td>
                <td className="px-3 py-1 text-[11px] text-text-dim whitespace-nowrap">
                  {p.now ? <>{p.now === abbr ? <span className="text-text-secondary">{p.now}</span> : p.now} {p.seen ? `'${String(p.seen).slice(2)}` : ""}</> : ""}
                  {p.traded ? <Link href={link({ tab: "trades", season: p.traded.date.slice(0, 4), dy: undefined })} className="ml-1 rounded border border-usf-gold/40 px-1 text-[9px] uppercase text-usf-gold">traded → {p.traded.to}</Link> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-text-dim">{year ? `${picks.length} picks in ${year}` : "The club's 30 picks with the most line WAR to date, 2011–26 classes"}. Bonus vs slot in $K. Draft data: MLB Stats API.</p>
    </div>
  );
}
