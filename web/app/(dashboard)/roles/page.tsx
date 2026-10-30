import Link from "next/link";
import { getRoles } from "@/lib/data";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Roles" };

/**
 * Role conversion (owner queue, RESULTS-MLB §87): which 2026 relievers could start, which starters play up
 * in a short burst. Both gates failed on small converter samples, so both boards are descriptive.
 */

const x3 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3).replace(/^0/, ""));
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const ci = (g: any) => `${(g.diff * 1e4).toFixed(1)} (${(g.lo * 1e4).toFixed(1)} to ${(g.hi * 1e4).toFixed(1)})`;

function Th({ children, left, title, first }: { children: React.ReactNode; left?: boolean; title?: string; first?: "asc" | "desc" }) {
  return <SortTh first={first} title={title} className={`py-1 px-1.5 font-semibold ${left ? "text-left" : "text-right"}`}>{children}</SortTh>;
}

function Who({ r }: { r: any }) {
  return (
    <td className="py-1 px-1.5 font-sans whitespace-nowrap">
      <span className="inline-flex items-center gap-1.5">
        <PixelTeamLogo team={r.team} size={14} />
        <Link prefetch={false} href={`/player/${r.id}?season=2026`} className="text-text-secondary hover:underline">{r.name}</Link>
        <span className="text-[10px] text-text-dim">{r.throws}HP</span>
      </span>
    </td>
  );
}

export default async function RolesPage({ searchParams }: { searchParams?: Promise<{ board?: string }> }) {
  const q = (await searchParams) ?? {};
  const data = await getRoles();
  if (!data) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">Roles have not been baked yet (pipeline/role_conversion.py).</div>;
  }
  const board = q.board === "sp" ? "sp" : "rp";
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const g = data.gates;
  const td = "py-1 px-1.5 text-right";

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Role conversion</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Two questions from real role changes in MLB 2020–26 (a reliever one season who started the next, and the reverse):
        which 2026 relievers could start, and which 2026 starters give more per batter in a short burst, the playoff or
        short-series use. All values are xwOBA allowed (lower is better for the pitcher).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/roles?board=rp" className={chip(board === "rp")}>Relievers who could start ({data.rpToSp.length})</Link>
        <Link href="/roles?board=sp" className={chip(board === "sp")}>Starters for the playoff bullpen ({data.spToRp.length})</Link>
      </div>

      <div className="glass-panel p-3 text-[11px] text-text-dim space-y-1 max-w-[110ch]">
        <p>
          <span className="rounded border border-usf-gold/40 px-1 text-[9px] uppercase tracking-wider text-usf-gold mr-1.5">
            {board === "rp" ? data.verdictA : data.verdictB}
          </span>
          {board === "rp" ? (
            <>
              Tested on {data.nA} relievers who became starters: their traits (arsenal depth, platoon gap, velo fade,
              grades, pitch counts) did not beat the plain projection (MSE gain ×10⁴ {ci(g.GA)}). The projection is his
              relief line shrunk to league average plus the league starter penalty of +{x3(data.penaltySp)}. The trait
              columns are context, not a forecast. Exploratory only: higher K+ went with doing better than projected.
            </>
          ) : (
            <>
              Tested on {data.nB} starters who moved to relief: projecting from his first time through the order did not
              beat projecting from his full line (MSE gain ×10⁴ {ci(g.GB1)}), and fade and TTO penalty added nothing
              ({ci(g.GB2)}). Converters gained {data.veloBump.mean > 0 ? "+" : ""}{data.veloBump.mean} mph on the fastball
              (95% CI {data.veloBump.lo} to {data.veloBump.hi}) and allowed {x3(Math.abs(data.offsetT1))} less xwOBA than
              their first-TTO line. Gain = full-outing xwOBA minus that short-burst estimate (positive = better in relief).
            </>
          )}
        </p>
      </div>

      <div className="glass-panel p-3 overflow-x-auto">
        {board === "rp" ? (
          <SortableTable key="rp" className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <Th left>Reliever</Th>
                <Th>BF</Th>
                <Th first="asc" title="xwOBA in relief, 2026">xwOBA</Th>
                <Th first="asc" title="relief xwOBA shrunk to the league RP mean (300 BF)">Shrunk</Th>
                <Th first="asc" title="naive projection as a starter: shrunk relief line + league SP penalty">Proj SP</Th>
                <Th title="pitch types with 10%+ usage (graded: whiff per swing at or above the league median for the type)">Depth</Th>
                <Th title="effective number of pitch types, exp(entropy of usage)">Eff</Th>
                <Th first="asc" title="xwOBA vs opposite-hand minus same-hand batters, shrunk">Platoon</Th>
                <Th title="fastball mph per 10 pitches within outings of 15+ pitches">Fade/10</Th>
                <Th title="fastball mph on 0-1 days rest minus 2+">Rest</Th>
                <Th>Pitch+</Th>
                <Th>K+</Th>
                <Th>Ctrl+</Th>
                <Th title="most pitches in one 2026 outing">Max P</Th>
                <Th title="career MLB + MiLB games started (MiLB from 2021)">Pro GS</Th>
              </tr>
            </thead>
            <tbody>
              {data.rpToSp.map((r: any) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <Who r={r} />
                  <td className={`${td} text-text-dim`}>{r.bf}</td>
                  <td className={td}>{x3(r.xwoba)}</td>
                  <td className={td}>{x3(r.xwobaShrunk)}</td>
                  <td className={`${td} font-semibold`}>{x3(r.projSp)}</td>
                  <td className={td} data-sort={r.gradedDepth}>{r.gradedDepth}/{r.depth}</td>
                  <td className={td}>{f1(r.effTypes)}</td>
                  <td className={td}><Signed v={r.platoonGap} dp={3} lowerIsGood /></td>
                  <td className={td}><Signed v={r.fadeInOuting} dp={1} /></td>
                  <td className={td}><Signed v={r.restVelo} dp={1} /></td>
                  <td className={td}>{f1(r.pitchingPlus)}</td>
                  <td className={td}>{f1(r.kPlus)}</td>
                  <td className={td}>{f1(r.controlPlus)}</td>
                  <td className={`${td} text-text-dim`}>{r.maxPitches}</td>
                  <td className={`${td} text-text-dim`}>{r.proGs}</td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        ) : (
          <SortableTable key="sp" className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <Th left>Starter</Th>
                <Th>BF</Th>
                <Th first="asc" title="xwOBA in starts, 2026">xwOBA</Th>
                <Th first="asc" title="xwOBA the first time through the order">TTO1</Th>
                <Th first="asc" title="third-plus time through minus first, shrunk">TTO pen</Th>
                <Th title="fastball mph, inning 1 minus innings 5+">Fade</Th>
                <Th title="fastball mph in starts, then plus the converter bump">Velo SP→RP</Th>
                <Th first="asc" title="short-burst estimate: shrunk first-TTO line + converter change">Relief</Th>
                <Th title="full-outing (shrunk) minus short-burst xwOBA; positive = better per batter in relief">Gain</Th>
              </tr>
            </thead>
            <tbody>
              {data.spToRp.map((r: any) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <Who r={r} />
                  <td className={`${td} text-text-dim`}>{r.bf}</td>
                  <td className={td}>{x3(r.xwoba)}</td>
                  <td className={td}>{x3(r.tto1)}</td>
                  <td className={td}><Signed v={r.ttoPen} dp={3} lowerIsGood /></td>
                  <td className={td}><Signed v={r.fadeByInning} dp={1} lowerIsGood /></td>
                  <td className={td} data-sort={r.veloRelief ?? ""}>{f1(r.veloSp)} → {f1(r.veloRelief)}</td>
                  <td className={td}>{x3(r.projRelief)}</td>
                  <td className={`${td} font-semibold`}><Signed v={r.gain} dp={3} /></td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        )}
      </div>
      <p className="text-[10px] text-text-dim">
        Season role follows the official G/GS line (SP when half his games were starts; openers count). Method and gates:
        glossary “Role conversion” and docs/formulas.md.
      </p>
    </div>
  );
}
