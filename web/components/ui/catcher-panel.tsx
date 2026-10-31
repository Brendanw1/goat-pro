"use client";

/**
 * Catcher defense depth (docs/catcher-defense-plan.md), under the §76 framing card on the Defense tab.
 * Framing splits come from the site's §76 called-strike model; blocking is priced by our §108b expected WP+PB and
 * throwing by our §108a-v2 xCS (floored) with §108c throwing + deterrence runs, Savant's expectations (xPBWP, exp CS,
 * CS above average, throwing runs) beside them, labelled as theirs. Locations are the catcher's view.
 * Video: "Watch" opens Savant's own page for that play — linked, never embedded.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { PctChip, Signed, signedFixed, GOOD, BAD } from "@/components/ui/shared-ui";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

const VIDEO = "https://baseballsavant.mlb.com/sporty-videos?playId=";
type Split = { k: string | number; n: number; v: number; runs: number; name?: string | null };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const f = (v: number | null | undefined, nd = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(nd) : "—");
const shade = (v: number, max: number) => (v > 0 ? GOOD : BAD) + Math.round(Math.min(0.85, Math.abs(v) / max) * 255).toString(16).padStart(2, "0");

function Section({ title, why, children }: { title: string; why: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title}</div>
      <p className="text-[11px] text-text-dim max-w-[85ch]"><span className="text-text-secondary">What this tells you: </span>{why}</p>
      {children}
    </div>
  );
}

function Tile({ label, value, sub, pct }: { label: string; value: React.ReactNode; sub?: string; pct?: number | null }) {
  return (
    <div className="min-w-[110px] rounded-lg border border-border-subtle px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
      <div className="flex items-center gap-2 font-data text-base text-text-primary">{value}{pct != null && <PctChip p={pct} />}</div>
      {sub && <div className="text-[10px] text-text-dim">{sub}</div>}
    </div>
  );
}

/** One split as a centred bar: strikes per 100 taken above expected (shrunk), green = gained. */
function SplitBars({ title, rows }: { title: string; rows: Split[] }) {
  if (!rows?.length) return null;
  const max = Math.max(4, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className="min-w-[200px] flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">{title}</div>
      {rows.map((r) => (
        <div key={String(r.k)} className="flex items-center gap-2 text-[11px]" title={`${r.n} taken · ${signedFixed(r.runs, 2)} runs`}>
          <span className="w-10 text-text-secondary">{r.k}</span>
          <span className="relative h-2.5 flex-1 rounded bg-current/[0.06] text-text-dim">
            <span className="absolute left-1/2 top-0 h-full w-px bg-current/40" />
            <span className="absolute top-0 h-full rounded" style={{
              left: r.v >= 0 ? "50%" : `${50 - (50 * Math.abs(r.v)) / max}%`, width: `${(50 * Math.abs(r.v)) / max}%`,
              background: r.v >= 0 ? GOOD : BAD }} />
          </span>
          <Signed v={r.v} dp={1} className="w-10 text-right font-data" />
          <span className="w-12 text-right font-data text-text-dim">{r.n.toLocaleString("en-US")}</span>
        </div>
      ))}
    </div>
  );
}

const REGION_POS: Record<string, [number, number]> = {
  "top-left": [0, 0], top: [1, 0], "top-right": [2, 0], left: [0, 1], right: [2, 1],
  "bottom-left": [0, 2], bottom: [1, 2], "bottom-right": [2, 2],
};

/** The shadow band split into eight edge regions around the zone, catcher's view, plate beneath. */
function RegionMap({ rows }: { rows: Split[] }) {
  const C = 62, X0 = 10, Y0 = 8, by = new Map(rows.map((r) => [String(r.k), r]));
  const max = Math.max(5, ...rows.map((r) => Math.abs(r.v)));
  const plateY = Y0 + 3 * C + 10;
  return (
    <svg viewBox={`0 0 ${2 * X0 + 3 * C} ${plateY + 30}`} className="w-full max-w-[240px]" role="img" aria-label="Framing by edge region, catcher's view">
      {Object.entries(REGION_POS).map(([k, [cx, cy]]) => {
        const r = by.get(k);
        return (
          <g key={k}>
            <rect x={X0 + cx * C + 1} y={Y0 + cy * C + 1} width={C - 2} height={C - 2} rx={4}
              fill={r ? shade(r.v, max) : "currentColor"} fillOpacity={r ? 1 : 0.04} className="text-text-dim">
              <title>{r ? `${k}: ${signedFixed(r.v, 1)} strikes per 100 vs expected · ${r.n} taken · ${signedFixed(r.runs, 2)} runs` : `${k}: under ${50} taken`}</title>
            </rect>
            {r && <text x={X0 + cx * C + C / 2} y={Y0 + cy * C + C / 2 + 2} textAnchor="middle" fontSize={12} className="fill-text-primary font-data">{signedFixed(r.v, 1)}</text>}
            {r && <text x={X0 + cx * C + C / 2} y={Y0 + cy * C + C / 2 + 15} textAnchor="middle" fontSize={8} fillOpacity={0.75} className="fill-text-primary font-data">n={r.n}</text>}
          </g>
        );
      })}
      <rect x={X0 + C} y={Y0 + C} width={C} height={C} fill="currentColor" fillOpacity={0.05} stroke="currentColor" strokeOpacity={0.6} className="text-text-primary" />
      <text x={X0 + 1.5 * C} y={Y0 + 1.5 * C + 3} textAnchor="middle" fontSize={8} className="fill-text-dim">heart</text>
      <path d={`M ${X0 + C} ${plateY} H ${X0 + 2 * C} V ${plateY + 8} L ${X0 + 1.5 * C} ${plateY + 20} L ${X0 + C} ${plateY + 8} Z`}
        fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.55} className="text-text-primary" />
    </svg>
  );
}

/** Pitches in the dirt and every WP/PB, catcher's view (ft); WP/PB dots open Savant's video. */
function DirtMap({ pts }: { pts: any[] }) {
  // Savant puts a pitch that bounced at z = 0 (the ground), so the map stops just under it; highs clamp to the top edge.
  const S = 44, x0 = -2.5, z1 = 4.5, W = 5 * S, H = 5.1 * S;
  const X = (x: number) => (Math.max(-2.5, Math.min(2.5, x)) - x0) * S, Y = (z: number) => (z1 - Math.max(-0.5, Math.min(4.4, z))) * S;
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full max-w-[260px]" role="img" aria-label="Pitches in the dirt and wild pitches or passed balls">
      <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" className="text-text-dim" />
      <text x={4} y={Y(0) - 3} fontSize={8} className="fill-text-dim">ground</text>
      <rect x={X(-0.83)} y={Y(3.5)} width={1.66 * S} height={2 * S} fill="none" stroke="currentColor" strokeOpacity={0.6} className="text-text-primary" />
      {pts.filter((p) => !p.wp).map((p, i) => (
        <circle key={`b${i}`} cx={X(p.x)} cy={Y(p.z)} r={2.5} fill="currentColor" fillOpacity={0.45} className="text-text-secondary" />
      ))}
      {pts.filter((p) => p.wp).map((p, i) => {
        const dot = <circle cx={X(p.x)} cy={Y(p.z)} r={4.5} fill={BAD} stroke="currentColor" strokeOpacity={0.5} className="text-text-primary">
          <title>{`WP/PB ${md(p.date)} · ${p.t ?? ""} · expected ${Math.round(100 * (p.xp ?? 0))}%${p.pid ? " · click to watch on Savant" : ""}`}</title>
        </circle>;
        return p.pid ? <a key={`w${i}`} href={VIDEO + p.pid} target="_blank" rel="noopener noreferrer">{dot}</a> : <g key={`w${i}`}>{dot}</g>;
      })}
      <path d={`M ${X(-0.71)} ${H + 4} H ${X(0.71)} V ${H + 10} L ${X(0)} ${H + 20} L ${X(-0.71)} ${H + 10} Z`}
        fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.55} className="text-text-primary" />
    </svg>
  );
}

/** Every throw on a steal attempt: pop time (catch to the fielder's glove) against arm strength, one dot per throw,
 *  green = caught, red = stolen; throws to second only (third is a shorter throw on another scale). Public MLB data has no arrival location for a throw,
 *  so this plots what Savant does publish. Click a dot for Savant's video of the play. */
function ThrowScatter({ events }: { events: any[] }) {
  const pts = events.filter((e) => e.base === "2B" && !e.held && e.pop != null && e.arm != null);
  if (pts.length < 3) return null;
  const W = 300, H = 230, L = 34, R = 10, T = 10, B = 28;
  const arms = pts.map((e) => e.arm), pops = pts.map((e) => e.pop);
  const a0 = Math.floor(Math.min(...arms) - 1), a1 = Math.ceil(Math.max(...arms) + 1);
  const p0 = Math.floor((Math.min(...pops) - 0.03) * 10) / 10, p1 = Math.ceil((Math.max(...pops) + 0.03) * 10) / 10;
  const X = (a: number) => L + ((a - a0) / (a1 - a0)) * (W - L - R);
  const Y = (v: number) => T + ((v - p0) / (p1 - p0)) * (H - T - B); // faster pop = higher on the plot
  const ticksP: number[] = []; for (let v = p0; v <= p1 + 1e-9; v += 0.1) ticksP.push(Math.round(v * 10) / 10);
  const ticksA: number[] = []; for (let v = Math.ceil(a0 / 2) * 2; v <= a1; v += 2) ticksA.push(v);
  const held = events.filter((e) => e.held).length, to3b = events.filter((e) => e.base !== "2B" && !e.held).length;
  return (
    <div className="w-full max-w-[320px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Pop time against arm strength on each throw">
        {ticksP.map((v) => (
          <g key={`p${v}`}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="currentColor" strokeOpacity={0.14} className="text-text-dim" />
            <text x={L - 4} y={Y(v) + 3} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.5} className="text-text-dim font-data">{v.toFixed(1)}s</text>
          </g>
        ))}
        {ticksA.map((v) => (
          <text key={`a${v}`} x={X(v)} y={H - B + 12} textAnchor="middle" fontSize={8} fill="currentColor" fillOpacity={0.5} className="text-text-dim font-data">{v}</text>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fontSize={8} className="fill-text-dim">arm strength, mph →</text>
        {pts.map((e, i) => {
          const c = e.res === "CS" ? GOOD : BAD, x = X(e.arm), y = Y(e.pop);
          const tip = `${md(e.date)} · ${e.runner} (${e.base}) · pop ${f(e.pop, 2)}s · arm ${f(e.arm)} mph · exchange ${f(e.exch, 2)}s · ${e.res === "CS" ? "caught" : "stolen"}${e.pid ? " · click to watch on Savant" : ""}`;
          const mark = <circle cx={x} cy={y} r={3.2} fill={c} fillOpacity={0.7}><title>{tip}</title></circle>;
          return e.pid ? <a key={i} href={VIDEO + e.pid} target="_blank" rel="noopener noreferrer">{mark}</a> : <g key={i}>{mark}</g>;
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-text-dim">
        <span><span style={{ color: GOOD }}>●</span> caught</span>
        <span><span style={{ color: BAD }}>●</span> stolen</span>
        {held > 0 && <span>{held} held (no throw)</span>}
        {to3b > 0 && <span>{to3b} to 3B (in the table)</span>}
      </div>
      <div className="text-[10px] text-text-dim">Each dot is one throw to second: pop time (up = quicker) against arm strength. Where a throw arrives at the bag is not public for MLB, so it is not drawn.</div>
    </div>
  );
}

const th = "px-2 py-1 text-right font-semibold";
const td = "px-2 py-1 text-right font-data";

export function CatcherPanel({ playerId, season }: { playerId: string; season: number | string }) {
  const [d, setD] = useState<any | null | undefined>(undefined);
  const [pitcher, setPitcher] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/catcher/${playerId}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [playerId, season]);
  if (!d) return null;
  const fr = d.framing, bl = d.blocking, tw = d.throwing;
  const events: any[] = (tw?.events ?? []).filter((e: any) => !pitcher || e.pitcherId === pitcher.id);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {fr && <Tile label="Framing" value={<span>{signedFixed(fr.per100, 2)}</span>} sub={`strikes / 100 taken vs §76 model · ${fr.taken.toLocaleString("en-US")} taken`} pct={fr.pct} />}
        {bl && <Tile label="Blocking" value={<Signed v={bl.aa} dp={1} />} sub={`WP+PB prevented vs our expected (§108b) · ${bl.dirt} in the dirt`} pct={bl.pct} />}
        {tw && <Tile label="Throwing" value={<Signed v={tw.ours?.csax ?? tw.csaa} dp={1} />} sub={tw.ours ? `CS above our xCS · ${tw.ours.att} attempts · Savant ${signedFixed(tw.csaa, 1)}` : `CS above Savant's expected · ${tw.att} attempts`} pct={tw.pct} />}
        {tw?.ours?.runs != null && <Tile label="Throwing runs" value={<Signed v={tw.ours.runs} dp={1} />} sub={`ours (CS + deterrence) · Savant ${tw.savant?.runs != null ? signedFixed(tw.savant.runs, 1) : "—"}`} />}
        {tw && <Tile label="Run deterrence" value={f(tw.att100, 2)} sub={`attempts per 100 chances (${(tw.opps ?? 0).toLocaleString("en-US")} pitches with a base open)`} pct={tw.pctRate} />}
      </div>

      {fr && (
        <Section title="Framing · where and with whom (site model, §76)"
          why="strikes he wins or loses against a called-strike model that knows location, count, hands and pitch but never saw him. The edge map is the shadow band where framing happens; the bars split the same number by pitcher hand, batter hand and pitch. Values are strikes per 100 taken pitches, shrunk toward average on small samples (n beside each).">
          <div className="flex flex-wrap items-start gap-6">
            <div>
              <RegionMap rows={fr.byRegion} />
              <div className="mt-1 max-w-[240px] text-[10px] text-text-dim">Catcher&apos;s view (left = third-base side). Box = the heart, not graded.</div>
            </div>
            <div className="flex min-w-[260px] flex-1 flex-col gap-4">
              <div className="flex flex-wrap gap-6">
                <SplitBars title="Pitcher hand" rows={fr.byPitcherHand} />
                <SplitBars title="Batter hand" rows={fr.byBatterHand} />
              </div>
              <SplitBars title="Pitch type" rows={fr.byPitch} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="max-h-[240px] overflow-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-text-dim"><th className="px-2 py-1 text-left font-semibold">Pitcher he caught</th><th className={th}>Taken</th><th className={th}>Strikes/100</th><th className={th}>Runs</th></tr></thead>
                <tbody>{fr.byPitcher.map((r: Split) => (
                  <tr key={String(r.k)} className="border-t border-border-subtle">
                    <td className="px-2 py-1"><Link prefetch={false} href={`/player/${r.k}?season=${season}`} className="text-text-primary hover:underline">{r.name ?? r.k}</Link></td>
                    <td className={`${td} text-text-dim`}>{r.n}</td><td className={td}><Signed v={r.v} dp={1} /></td><td className={td}><Signed v={r.runs} dp={2} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">By season (shrunk runs · Framing+)</div>
              <div className="flex flex-wrap gap-2">
                {fr.trend.map((t: any) => (
                  <div key={t.season} className={`rounded-md border px-2 py-1 text-center ${String(t.season) === String(season) ? "border-usf-gold/60" : "border-border-subtle"}`}>
                    <div className="text-[10px] text-text-dim">{t.season}</div>
                    <Signed v={t.runs} dp={1} className="font-data text-sm" />
                    <div className="font-data text-[10px] text-text-secondary">{t.plus != null ? Math.round(t.plus) : "—"}</div>
                    <div className="text-[9px] text-text-dim">{t.taken.toLocaleString("en-US")}</div>
                  </div>
                ))}
              </div>
              {Number(season) >= 2026 && <p className="mt-2 text-[10px] text-text-dim">2026 is the ABS challenge era: a called strike can be overturned, so framing is worth less than before.</p>}
            </div>
          </div>
        </Section>
      )}

      {bl && (
        <Section title="Blocking · pitches in the dirt (site model, §108b)"
          why="how often a pitch with a runner on gets by him. Every grey dot is a pitch in the dirt he kept in front; red dots are wild pitches and passed balls (click one to watch it on Savant). Prevented = our expected WP+PB for those exact pitches (location, dirt, pitch type, hands, speed; a model that never saw him) minus what happened, so plus is good. Savant's own number sits beside it.">
          <div className="flex flex-wrap gap-2">
            <Tile label="Chances" value={bl.opp.toLocaleString("en-US")} sub="pitches with a runner on" />
            <Tile label="In the dirt" value={bl.dirt} />
            <Tile label="WP + PB" value={bl.pbwp} sub={`${f(bl.per100dirt)} per 100 in the dirt`} />
            <Tile label="Expected" value={f(bl.x)} sub={`site model · Savant ${f(bl.xSav)}`} />
            <Tile label="Prevented" value={<Signed v={bl.aa} dp={1} />} pct={bl.pct} sub={bl.savant ? `Savant: ${signedFixed(bl.savant.baa, 0)} blocks, ${signedFixed(bl.savant.runs, 1)} runs` : undefined} />
          </div>
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <div><DirtMap pts={bl.pts} /><div className="mt-1 text-[10px] text-text-dim">Catcher&apos;s view, feet; box = rulebook zone; dashed line = the ground.</div></div>
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-text-dim"><th className="px-2 py-1 text-left font-semibold">Pitcher</th><th className={th}>Runner on</th><th className={th}>Dirt</th><th className={th}>WP+PB</th><th className={th}>Expected</th><th className={th}>Prevented</th></tr></thead>
                <tbody>{bl.byPitcher.map((r: any) => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="px-2 py-1"><Link prefetch={false} href={`/player/${r.id}?season=${season}`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link></td>
                    <td className={`${td} text-text-dim`}>{r.opp}</td><td className={td}>{r.dirt}</td><td className={td}>{r.pbwp}</td><td className={`${td} text-text-dim`}>{f(r.x)}</td>
                    <td className={td}><Signed v={r.x - r.pbwp} dp={1} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      {tw && (
        <Section title="Running game · throwing (site xCS, §108a-v2 / §108c; Savant's beside)"
          why="how often runners go on him and how often he gets them. Our xCS is each attempt's chance of a caught stealing from the runner's speed and lead, the base, pitcher hand, pickoff throws and the lead that pitcher usually allows, scored by a model that never saw that season; CS above xCS is the outs he got beyond it. Throwing runs price those outs with base-out run expectancy and add deterrence: attempts runners did not make that a typical catcher would have drawn, times what an attempt is worth. Pop time (catch to the fielder's glove), exchange and arm show why. Savant's expected CS, CS above average and throwing runs are theirs, labelled.">
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-md border border-border-subtle px-2 py-0.5 text-text-secondary">xCS: {tw.ours?.status ?? "ranking confirmed pre-2020; level era-specific; 2027 confirm pending"}</span>
            <span className="rounded-md border border-border-subtle px-2 py-0.5 text-text-secondary">Deterrence: {tw.ours?.deterStatus ?? "passes 2020-26 only, small (about 0.2 runs sd)"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tile label="Attempts" value={tw.att} sub={`${tw.sb} SB · ${tw.cs} CS`} />
            <Tile label="CS%" value={f(tw.csPct)} sub={tw.ours ? `our xCS ${f(tw.ours.xcsPct)}% · ${tw.ours.att} to 2B/3B` : undefined} />
            {tw.ours && <Tile label="CS above xCS" value={<Signed v={tw.ours.csax} dp={1} />} pct={tw.pct} sub={`ours · ${signedFixed(tw.ours.csaxPer, 3)} per attempt`} />}
            {tw.ours?.runs != null && <Tile label="Throwing runs" value={<Signed v={tw.ours.runs} dp={1} />} sub={`ours: ${signedFixed(tw.ours.runsCS, 1)} CS + ${signedFixed(tw.ours.runsDeter, 2)} deterrence`} />}
            {tw.ours?.deter && <Tile label="Attempts vs expected" value={<Signed v={tw.ours.deter.below} dp={1} />} sub={`ours: ${tw.ours.deter.att} made, ${f(tw.ours.deter.exp)} expected (+ = fewer)`} />}
            <Tile label="Savant" value={<Signed v={tw.csaa} dp={1} />} pct={tw.pctSav} sub={`their CS above avg · exp CS ${f(tw.xcs)}${tw.savant?.runs != null ? ` · ${signedFixed(tw.savant.runs, 1)} runs` : ""}`} />
            <Tile label="Pop time" value={f(tw.pop, 2)} sub="s, on his throws" />
            <Tile label="Exchange" value={f(tw.exchange, 2)} sub="s" />
            <Tile label="Arm" value={f(tw.arm, 1)} sub="mph" />
          </div>
          <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <ThrowScatter events={events} />
          <div className="overflow-x-auto">
            <SortableTable className="w-full min-w-max text-[11px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <SortTh className="px-2 py-1 text-left font-semibold">Pitcher (click to filter plays)</SortTh><SortTh className={th}>Chances</SortTh><SortTh className={th}>Att</SortTh><SortTh className={th}>Att/100</SortTh>
                <SortTh className={th}>SB</SortTh><SortTh className={th}>CS</SortTh><SortTh className={th}>Lead ft</SortTh><SortTh className={th}>Runner spd</SortTh><SortTh className={th} title="CS above our xCS (2B/3B attempts)">CS vs xCS</SortTh><SortTh className={th} title="CS above Savant's expected">vs Savant</SortTh></tr></thead>
              <tbody>{tw.byPitcher.map((r: any) => (
                <tr key={r.id} className={`border-t border-border-subtle ${pitcher?.id === r.id ? "bg-current/[0.04]" : ""}`}>
                  <td className="px-2 py-1"><button type="button" onClick={() => setPitcher(pitcher?.id === r.id ? null : { id: r.id, name: r.name ?? String(r.id) })} className="text-left text-text-primary hover:underline">{r.name ?? r.id}</button></td>
                  <td className={`${td} text-text-dim`}>{r.opps || "—"}</td><td className={td}>{r.att}</td><td className={td}>{r.opps ? f((100 * r.att) / r.opps, 1) : "—"}</td>
                  <td className={td}>{r.sb}</td><td className={td}>{r.cs}</td><td className={td}>{f(r.lead)}</td><td className={td}>{f(r.spd)}</td>
                  <td className={td}>{r.x2 != null && r.att2 ? <Signed v={r.cs2 - r.x2} dp={1} /> : "—"}</td>
                  <td className={td}><Signed v={r.cs - r.xcs} dp={1} /></td>
                </tr>))}</tbody>
            </SortableTable>
          </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-dim">
              <span>Every attempt{pitcher ? ` · ${pitcher.name}` : ""} ({events.length})</span>
              {pitcher && <button type="button" onClick={() => setPitcher(null)} className="normal-case text-text-secondary hover:underline">show all</button>}
            </div>
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full min-w-max text-[11px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="px-2 py-1 text-left font-semibold">Date</th><th className="px-2 py-1 text-left font-semibold">Runner</th><th className="px-2 py-1 text-left font-semibold">Pitcher</th>
                  <th className={th}>Base</th><th className={th}>Lead</th><th className={th}>Spd</th><th className={th}>Pop</th><th className={th} title="our xCS (§108a-v2)">xCS</th><th className={th} title="Savant's exp_cs">Sav exp</th><th className={th}>Result</th><th className={th}>Video</th></tr></thead>
                <tbody>{[...events].reverse().map((e, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="px-2 py-1 font-data text-text-dim">{md(e.date)}</td>
                    <td className="px-2 py-1"><Link prefetch={false} href={`/player/${e.rid}?season=${season}`} className="text-text-secondary hover:underline">{e.runner}</Link></td>
                    <td className="px-2 py-1 text-text-secondary">{e.pitcher}</td>
                    <td className={td}>{e.base}</td><td className={td}>{f(e.lead)}</td><td className={td}>{f(e.spd)}</td>
                    <td className={td}>{e.held ? <span className="text-text-dim" title="no throw">held</span> : f(e.pop, 2)}</td>
                    <td className={td}>{e.x2 != null ? `${Math.round(100 * e.x2)}%` : "—"}</td>
                    <td className={`${td} text-text-dim`}>{e.xcs != null ? `${Math.round(100 * e.xcs)}%` : "—"}</td>
                    <td className={td} style={{ color: e.res === "CS" ? GOOD : undefined }}>{e.res}</td>
                    <td className={td}>{e.pid ? <a href={VIDEO + e.pid} target="_blank" rel="noopener noreferrer" className="text-usf-gold hover:underline">Watch ↗</a> : "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>
        </Section>
      )}
      <p className="text-[10px] text-text-dim">Framing: site model (RESULTS-MLB §76). Blocking: Baseball Savant&apos;s public per-play rows priced by our expected WP+PB (§108b, passed its gates). Throwing: Savant&apos;s rows priced by our xCS (§108a-v2: shipped on leave-one-season-out; §108c: ranking confirmed on 2016-19, level era-specific, 2027 confirm pending), runs and deterrence from §108c; Savant&apos;s expected CS and runs labelled. Watch opens Baseball Savant&apos;s video of the pitch the runner went on (or the wild pitch / passed ball). Percentiles among that season&apos;s catchers with {">"}100 pitches in the dirt / 15+ attempts.</p>
    </div>
  );
}
