"use client";

/**
 * Site defense (D-12/D-13, RESULTS-MLB §75/§76/§80), the college defense card + drill + plays + catcher zone
 * adapted to Statcast. One card per graded position: runs vs an average fielder there (shrunk, 90% interval,
 * percentile within the position among qualified players), then "where it happened" and the graded plays.
 * Catchers: framing runs and Framing+ with a called-minus-expected grid (catcher's view) and per-game lines.
 */
import { useEffect, useState } from "react";
import { percentileColor, signTone } from "@/lib/percentiles";
import { signedFixed } from "@/components/ui/shared-ui";

type Chance = { x: number | null; y: number | null; dir: number | null; ev: number | null; la: number | null; p: number; made: boolean;
  share: number; credit: number; runs: number; date: string; inning: number; half: string; outs: number; bats: string; event: string };
type Card = { pos: string; group: string; chances: number; qualified: boolean; oaa: number; oaaShrunk: number; runs: number; runsShrunk: number;
  lo: number; hi: number; reliability: number; pct: number | null; chanceList: Chance[] };
type Catcher = { taken: number; runs: number; runsShrunk: number; lo: number; hi: number; per100: number; framingPlus: number | null;
  qualified: boolean; pct: number | null; reliability: number; cells: { cx: number; cz: number; n: number; v: number }[];
  games: { date: string; n: number; runs: number; strikesVsExp: number }[] };

const MADE = percentileColor(95), MISSED = percentileColor(5);
/** Statcast catch-probability bands (1 star = routine, 5 = rarely made). */
const stars = (p: number) => (p >= 0.9 ? 1 : p >= 0.75 ? 2 : p >= 0.5 ? 3 : p >= 0.25 ? 4 : 5);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dotR = (c: Chance) => 2 + 5 * Math.min(1, Math.abs(c.runs) / 0.8);
const tip = (c: Chance) =>
  `${c.made ? "Out made" : "Not made"} · ${c.event.replace(/_/g, " ")} · ${md(c.date)} ${c.half === "Bot" ? "▼" : "▲"}${c.inning}, ${c.outs} out\n` +
  `Out chance ${(100 * c.p).toFixed(0)}% (${"★".repeat(stars(c.p))}) · his share ${(100 * c.share).toFixed(0)}%\n` +
  `EV ${c.ev ?? "—"} mph, LA ${c.la ?? "—"}° · credit ${signedFixed(c.credit, 2)} · ${signedFixed(c.runs, 2)} runs`;

function PctBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[10px] text-text-dim">not qualified to rank</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 w-28 rounded-full bg-white/10">
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40"
          style={{ left: `${pct}%`, background: percentileColor(pct) }} />
      </span>
      <span className="font-data text-xs" style={{ color: percentileColor(pct) }}>{pct}</span>
    </span>
  );
}

/** Outfield: landing points (ft from home, + = right field); infield: spray direction x exit velocity. */
function Drill({ card }: { card: Card }) {
  const of = card.group === "OF";
  const W = 300, H = 230, cx = W / 2, base = H - 12;
  const pts = card.chanceList.map((c) => {
    if (of && c.x != null && c.y != null) return { c, px: cx + (c.x / 430) * (W / 2) * 1.35, py: base - (c.y / 430) * (H - 24) };
    if (!of && c.dir != null && c.ev != null) {
      const r = (Math.max(40, Math.min(120, c.ev)) - 30) / 90 * (H - 30), a = (c.dir * Math.PI) / 180;
      return { c, px: cx + r * Math.sin(a), py: base - r * Math.cos(a) };
    }
    return null;
  }).filter(Boolean) as { c: Chance; px: number; py: number }[];
  const line = (deg: number, len: number) => `M${cx},${base} L${cx + len * Math.sin((deg * Math.PI) / 180)},${base - len * Math.cos((deg * Math.PI) / 180)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[420px]" role="img" aria-label={`${card.pos.toUpperCase()} chances`}>
      <path d={line(-45, H)} stroke="rgba(255,255,255,0.15)" /><path d={line(45, H)} stroke="rgba(255,255,255,0.15)" />
      {of
        ? [200, 300, 400].map((ft) => <circle key={ft} cx={cx} cy={base} r={(ft / 430) * (H - 24)} fill="none" stroke="rgba(255,255,255,0.06)" />)
        : [60, 90, 110].map((ev) => <circle key={ev} cx={cx} cy={base} r={((ev - 30) / 90) * (H - 30)} fill="none" stroke="rgba(255,255,255,0.06)" />)}
      {pts.map(({ c, px, py }, i) => (
        <circle key={i} cx={px.toFixed(1)} cy={py.toFixed(1)} r={dotR(c).toFixed(1)} fill={c.made ? MADE : MISSED}
          fillOpacity={0.25 + 0.6 * c.share} stroke="rgba(0,0,0,0.4)" strokeWidth={0.5}>
          <title>{tip(c)}</title>
        </circle>
      ))}
      <text x={6} y={12} className="fill-current text-[9px]" opacity={0.5}>{of ? "landing spot · rings 200/300/400 ft" : "spray × exit velo · rings 60/90/110 mph"}</text>
    </svg>
  );
}

function Plays({ card }: { card: Card }) {
  const top = [...card.chanceList].sort((a, b) => Math.abs(b.runs) - Math.abs(a.runs)).slice(0, 12);
  const tiers = [1, 2, 3, 4, 5].map((s) => {
    const cs = card.chanceList.filter((c) => stars(c.p) === s);
    const w = cs.reduce((t, c) => t + c.share, 0);
    return { s, n: w, made: cs.filter((c) => c.made).reduce((t, c) => t + c.share, 0), exp: cs.reduce((t, c) => t + c.share * c.p, 0) };
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
        {tiers.map((t) => (
          <div key={t.s} className="rounded bg-white/[0.03] px-1 py-1.5" title="Chances weighted by his share; made vs expected of an average fielder">
            <div className="text-text-dim">{"★".repeat(t.s)}</div>
            <div className="font-data text-text-secondary">{t.n ? `${t.made.toFixed(0)}/${t.n.toFixed(0)}` : "—"}</div>
            <div className="font-data text-text-dim">exp {t.exp.toFixed(1)}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Biggest plays</div>
      {top.map((c, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] font-data" title={tip(c)}>
          <span className="h-2 w-2 rounded-full" style={{ background: c.made ? MADE : MISSED }} />
          <span className="w-10 text-text-dim">{md(c.date)}</span>
          <span className="w-28 truncate text-text-secondary">{c.event.replace(/_/g, " ")}</span>
          <span className="w-14 text-text-dim">{"★".repeat(stars(c.p))}</span>
          <span className="w-12 text-right text-text-dim">{(100 * c.p).toFixed(0)}%</span>
          <span className={`w-14 text-right ${signTone(c.runs)}`}>{signedFixed(c.runs, 2)}</span>
        </div>
      ))}
    </div>
  );
}

function CatcherZone({ c }: { c: Catcher }) {
  const S = 52, x0 = -1.5, z1 = 4.25, w = 3 * S, h = 3.25 * S;
  const col = (v: number) => (v > 0 ? `rgba(52,211,153,${Math.min(0.85, Math.abs(v) / 25)})` : `rgba(251,113,133,${Math.min(0.85, Math.abs(v) / 25)})`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[260px]" role="img" aria-label="Framing by location">
      {c.cells.map((k, i) => (
        <rect key={i} x={((k.cx - 0.125 - x0) * S).toFixed(1)} y={((z1 - k.cz - 0.125) * S).toFixed(1)} width={S * 0.25} height={S * 0.25} fill={col(k.v)}>
          <title>{`${k.n} taken pitches · ${signedFixed(k.v, 1)} strikes per 100 vs expected (shrunk)`}</title>
        </rect>
      ))}
      <rect x={(-0.83 - x0) * S} y={(z1 - 3.5) * S} width={1.66 * S} height={2 * S} fill="none" stroke="rgba(255,255,255,0.5)" />
    </svg>
  );
}

export function DefensePanel({ playerId, season }: { playerId: string; season: number | string }) {
  const [d, setD] = useState<any | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/defense/${playerId}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [playerId, season]);
  if (d === undefined) return <div className="glass-panel p-4 text-xs text-text-dim">Loading defense…</div>;
  if (!d || (!d.cards?.length && !d.catcher))
    return <div className="glass-panel p-4 text-xs text-text-dim">No site defense grade for {season}: under the sample floor, or a position whose model did not pass its gate (see the glossary). Savant&apos;s numbers are on the Savant tab.</div>;
  const c: Catcher | null = d.catcher;
  return (
    <div className="space-y-5">
      {c && (
        <div className="glass-panel p-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Catcher · framing (site model)</span>
            <span className={`font-data text-lg ${signTone(c.runsShrunk)}`}>{signedFixed(c.runsShrunk, 2)} runs</span>
            <span className="text-[11px] text-text-dim">90% {signedFixed(c.lo, 1)} to {signedFixed(c.hi, 1)} · raw {signedFixed(c.runs, 2)} · {c.taken.toLocaleString("en-US")} taken pitches</span>
            {c.framingPlus != null && <span className="text-xs text-text-secondary">Framing+ <span className="font-data text-text-primary">{Math.round(c.framingPlus)}</span></span>}
            <PctBar pct={c.pct} />
          </div>
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <div>
              <CatcherZone c={c} />
              <div className="mt-1 text-[10px] text-text-dim">Strikes gained (green) or lost (red) per 100 taken pitches vs an average catcher, catcher&apos;s view; box = rulebook zone.</div>
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              <div className="flex text-[10px] uppercase tracking-wider text-text-dim"><span className="w-14">Game</span><span className="w-14 text-right">Taken</span><span className="w-20 text-right">Strikes ±</span><span className="w-16 text-right">Runs</span></div>
              {[...c.games].reverse().map((g) => (
                <div key={g.date} className="flex text-[11px] font-data text-text-secondary">
                  <span className="w-14 text-text-dim">{md(g.date)}</span><span className="w-14 text-right">{g.n}</span>
                  <span className={`w-20 text-right ${signTone(g.strikesVsExp, 0.5)}`}>{signedFixed(g.strikesVsExp, 1)}</span>
                  <span className={`w-16 text-right ${signTone(g.runs, 0.05)}`}>{signedFixed(g.runs, 2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {(d.cards as Card[]).map((k) => (
        <div key={k.pos} className="glass-panel p-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{k.pos.toUpperCase()} · range (site model)</span>
            <span className={`font-data text-lg ${signTone(k.runsShrunk)}`}>{signedFixed(k.runsShrunk, 2)} runs</span>
            <span className="text-[11px] text-text-dim">90% {signedFixed(k.lo, 1)} to {signedFixed(k.hi, 1)} · OAA {signedFixed(k.oaaShrunk, 1)} (raw {signedFixed(k.oaa, 1)}) · {k.chances.toFixed(0)} chances</span>
            <PctBar pct={k.pct} />
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr]">
            <Drill card={k} />
            <Plays card={k} />
          </div>
        </div>
      ))}
      <p className="text-[11px] text-text-dim">Site models refit on Statcast (RESULTS-MLB §75/§76/§80). Runs are vs an average fielder at the position, shrunk by measured reliability; Savant&apos;s own numbers sit on the Savant tab for comparison.</p>
    </div>
  );
}
