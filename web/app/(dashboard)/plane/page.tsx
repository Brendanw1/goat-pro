import Link from "next/link";
import { getPlaneLeague } from "@/lib/data";
import { PITCH_CONFIG } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Swing plane" };

/**
 * League swing plane match (RESULTS-MLB §90b, pipeline/plane_match_v2.py). s = attack angle + VAA (+ = swing steeper than
 * the pitch's descent). MLB 2024–26 regular season, competitive swings. Descriptive, not a forecast.
 */
const GOLD = "#e3b341", GREY = "#8b93a7", DIM = "#5d6577";
const GROUPS = [["FF", "four-seam", PITCH_CONFIG.FF.color], ["SI", "sinker", PITCH_CONFIG.SI.color], ["FC", "cutter", PITCH_CONFIG.CT.color],
  ["SL", "slider", PITCH_CONFIG.SL.color], ["CU", "curve", PITCH_CONFIG.CB.color], ["CH", "change", PITCH_CONFIG.CH.color]] as const;
const HEIGHTS = [["high", "Up in the zone (2.68+ ft)"], ["mid", "Middle"], ["low", "Down (under 2.08 ft)"]] as const;
const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");

function Fig({ title, n, read, children }: { title: string; n: string; read: string; children: React.ReactNode }) {
  return (
    <figure className="glass-panel p-4 flex flex-col">
      <figcaption className="mb-2">
        <h2 className="text-[13px] font-semibold text-text-primary leading-snug">{title}</h2>
        <div className="text-[10px] text-text-dim">{n}</div>
      </figcaption>
      <div className="flex-1">{children}</div>
      <p className="mt-2 text-[11px] text-text-secondary leading-snug">{read}</p>
    </figure>
  );
}

/** Sweet-spot rate vs s, one height: a line per pitch group, pp vs s = 0 (FE spline, depth held). */
function SweetSpot({ p1, h }: { p1: Record<string, any>; h: string }) {
  const W = 320, H = 190, PL = 30, PR = 8, PT = 10, PB = 28;
  const series = GROUPS.map(([g, , c]) => ({ g, c, pts: p1[`${g}-${h}`]?.curve ?? [] })).filter((x) => x.pts.length > 1);
  const ys = series.flatMap((x) => x.pts.map((p: any) => p.pp)), y0 = Math.min(-12, ...ys), y1 = Math.max(3, ...ys);
  const sx = (v: number) => PL + ((v + 15) / 40) * (W - PL - PR), sy = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="sweet-spot rate by plane mismatch">
      <line x1={sx(0)} x2={sx(0)} y1={PT} y2={H - PB} stroke="rgba(227,179,65,0.4)" strokeDasharray="3 3" />
      <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.12)" />
      <text x={sx(0) + 3} y={PT + 8} fontSize={8} fill={GOLD}>matched</text>
      {series.map((x) => (
        <path key={x.g} d={path(x.pts.map((p: any) => [sx(p.s), sy(p.pp)] as [number, number]))} fill="none" stroke={x.c} strokeWidth={1.4} opacity={0.9} />
      ))}
      {[-15, -5, 5, 15, 25].map((v) => <text key={v} x={sx(v)} y={H - PB + 11} textAnchor="middle" fontSize={8} fill={DIM}>{v > 0 ? `+${v}` : v}</text>)}
      {[y0, 0, y1].map((v) => <text key={v} x={PL - 3} y={sy(v) + 3} textAnchor="end" fontSize={8} fill={DIM}>{v.toFixed(0)}</text>)}
      <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize={8} fill={DIM}>flatter than the pitch ← s (°) → steeper</text>
    </svg>
  );
}

function Forgive({ c }: { c: Record<string, any[]> }) {
  const W = 460, H = 230, PL = 36, PR = 80, PT = 12, PB = 30;
  const bins = c.matched.map((b) => b.bin);
  const ys = [...c.matched, ...c.mismatched].map((b) => b.xw), y0 = Math.min(...ys) - 0.01, y1 = Math.max(...ys) + 0.01;
  const sx = (i: number) => PL + (i / (bins.length - 1)) * (W - PL - PR), sy = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const lines = [["matched", GOLD, "matched plane"], ["mismatched", GREY, "mismatched"]] as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label="xwOBA on contact by timing error, matched vs mismatched">
      {lines.map(([k, col, lab]) => {
        const pts = c[k].map((b, i) => [sx(i), sy(b.xw)] as [number, number]);
        return (
          <g key={k}>
            <path d={path(pts)} fill="none" stroke={col} strokeWidth={2} />
            {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={col} />)}
            <text x={pts[pts.length - 1][0] + 6} y={pts[pts.length - 1][1] + 3} fontSize={9} fill={col}>{lab}</text>
          </g>
        );
      })}
      {[y0, (y0 + y1) / 2, y1].map((v) => <text key={v} x={PL - 4} y={sy(v) + 3} textAnchor="end" fontSize={8} fill={DIM}>{v.toFixed(3).replace(/^0/, "")}</text>)}
      {bins.map((b, i) => <text key={b} x={sx(i)} y={H - PB + 12} textAnchor="middle" fontSize={8} fill={DIM}>{b.replace("-99", "+").replace("-", "–")}</text>)}
      <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize={8} fill={DIM}>in. early or late vs his own mean contact depth</text>
    </svg>
  );
}

export default async function PlanePage() {
  const lg = await getPlaneLeague();
  if (!lg) return <div className="glass-panel p-8 text-center text-sm text-text-dim">Swing plane has not been baked yet (pipeline/plane_match_v2.py export).</div>;
  const all = lg.p1.all, v = lg.verdict;
  const at = (s: number) => all.curve.find((p: any) => p.s === s)?.pp;
  const m = lg.p2.curves.matched, mm = lg.p2.curves.mismatched;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Swing plane</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Does the bat&apos;s path match the pitch&apos;s? s = attack angle + vertical approach angle: 0 means the bat rises at the angle the
        ball falls, + means the swing is steeper than the pitch. Statcast bat tracking, MLB 2024–26 regular season, competitive swings;
        within-hitter comparisons (each hitter against himself). Explored on 2024–25 and confirmed once on 2026 (RESULTS-MLB §90b).
        Descriptive, not a forecast. The attack angle Statcast reports at contact moves with timing (a ball met further out front meets
        a bat that is rising more), so these are reads of contact as it happened, not swing advice.
      </p>

      <Fig title={`Sweet-spot rate peaks when the swing mirrors the pitch: ${Math.abs(at(15) ?? 0).toFixed(1)} pp lower at s = +15, ${Math.abs(at(-10) ?? 0).toFixed(1)} pp lower at s = −10`}
        n={`${all.n.toLocaleString()} balls in play · sweet spot = launch angle 8–32° · pp vs s = 0, hitter-season fixed effects, contact depth, location, count and velocity held · 2026 confirmation +${(100 * v.P1.est).toFixed(1)} pp (CI ${(100 * v.P1.ci[0]).toFixed(1)} to ${(100 * v.P1.ci[1]).toFixed(1)})`}
        read="Each line is a pitch group, drawn over the range of s it actually sees. Swings steeper than the pitch lift balls into pop-ups; flatter ones drive them into the ground. The best launch band sits near a matched plane at every height.">
        <div className="grid gap-3 md:grid-cols-3">
          {HEIGHTS.map(([h, lab]) => (
            <div key={h}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">{lab}</div>
              <SweetSpot p1={lg.p1} h={h} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-[10px]">
          {GROUPS.map(([g, lab, c]) => <span key={g} style={{ color: c }}>{lab}</span>)}
        </div>
      </Fig>

      <Fig title="A matched plane forgives timing: mismatched swings lose damage fast once they are early or late"
        n={`xwOBA on contact (hitter-season centred) · matched = |s| ≤ ${lg.p2.absS[0]}°, mismatched = |s| ≥ ${lg.p2.absS[1]}° · 2026 confirmation ${v.P2.est.toFixed(3)} xwOBA per 5 in. × IQR |s| (CI ${v.P2.ci[0].toFixed(3)} to ${v.P2.ci[1].toFixed(3)})`}
        read={`Matched swings hold about ${m[0].xw.toFixed(3).replace(/^0/, "")} out to 13 in. off his normal depth; mismatched swings fall from a peak of ${Math.max(...mm.map((b: any) => b.xw)).toFixed(3).replace(/^0/, "")} to ${mm[mm.length - 1].xw.toFixed(3).replace(/^0/, "")} at 13+ in. Squared-up rate does not show it (exit speed and launch band trade off).`}>
        <Forgive c={lg.p2.curves} />
      </Fig>

      <div className="glass-panel p-4 text-[11px] text-text-secondary leading-relaxed max-w-[95ch]">
        <p>
          <strong className="text-text-primary">Hitter plane fit.</strong> A hitter&apos;s attack angle by pitch group and height, from his
          other swings, is a stable trait (split-half {v.P4.est.toFixed(2)}). Where his plane runs steeper than his own norm vs the league,
          he makes fewer contacts the next season: {(100 * v.P3.est).toFixed(1)} pp per 5.4° (CI {(100 * v.P3.ci[0]).toFixed(1)} to {(100 * v.P3.ci[1]).toFixed(1)}),
          beyond his own prior contact rate there. It is a contact read, not damage: the same plane did not predict xwOBA on contact.
          It shows on each hitter&apos;s Swing tab and as the Plane column on <Link href="/matchup" className="underline">Matchup</Link>.
        </p>
        <p className="mt-2 text-text-dim">
          Not shown: an |AA + VAA| &quot;match&quot; score for contact (no effect beyond the signed plane), whiff reads from the swing&apos;s own
          attack angle (on a whiff Statcast takes it at a projected point, so it runs about 2° steeper by construction), and a pitcher
          plane-separation read (a fastball&apos;s VAA against the lineup&apos;s planes added nothing to whiffs).
        </p>
      </div>
    </div>
  );
}
