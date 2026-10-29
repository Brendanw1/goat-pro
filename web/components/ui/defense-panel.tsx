"use client";

/**
 * Site defense (D-12/D-13, RESULTS-MLB §75/§76/§80/§81), the college defense card + drill + plays + catcher zone
 * adapted to Statcast. One card per graded position: runs vs an average fielder there (shrunk, 90% interval,
 * percentile within the position among qualified players), then "where it happened" and the graded plays.
 * Catchers: framing runs and Framing+ with a called-minus-expected grid (catcher's view) and per-game lines.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { BallField } from "@/components/ui/ball-field";
import { percentileColor, signTone } from "@/lib/percentiles";
import { signedFixed } from "@/components/ui/shared-ui";

type Chance = { x: number | null; y: number | null; dir: number | null; ev: number | null; la: number | null; p: number; made: boolean;
  share: number; credit: number; runs: number; date: string; inning: number; half: string; outs: number; bats: string; event: string;
  g?: number; batter?: string | null; des?: string | null; pid?: string | null; hr?: number | null };
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

const savantFeed = (g: number) => `https://baseballsavant.mlb.com/gamefeed?gamePk=${g}`;
const savantPlay = (pid: string) => `https://baseballsavant.mlb.com/sporty-videos?playId=${pid}`;
const hardest = (c: Chance) => c.made && c.p < 0.5;

/** A play's clip, resolved on click from Savant (nothing stored): MLB's mp4 plays inline. */
function Clip({ pid }: { pid: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/savant-video?playId=${pid}`).then((r) => r.json()).then((j) => live && setUrl(j.url ?? null)).catch(() => live && setUrl(null));
    return () => { live = false; };
  }, [pid]);
  if (url === undefined) return <div className="text-[10px] text-text-dim">Loading clip…</div>;
  if (!url) return <a href={savantPlay(pid)} target="_blank" rel="noopener noreferrer" className="text-[11px] underline">Clip not found here — open on Savant ↗</a>;
  return <video src={url} controls autoPlay muted playsInline preload="none" className="w-full max-w-[420px] rounded border border-border-subtle" />;
}

/** The selected play: what happened, the odds, and where to watch it. */
function PlayDetail({ c, onClose }: { c: Chance; onClose: () => void }) {
  const [play, setPlay] = useState(false);
  useEffect(() => setPlay(false), [c]);
  return (
    <div className="rounded-lg border border-border-subtle bg-white/[0.03] p-3 space-y-1.5 text-[11px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold" style={{ color: c.made ? MADE : MISSED }}>{c.made ? "Out made" : "Not made"}</span>
          <span className="text-text-dim"> · {md(c.date)} {c.half === "Bot" ? "▼" : "▲"}{c.inning}, {c.outs} out · vs {c.bats}HH</span>
        </div>
        <button type="button" onClick={onClose} className="text-text-dim hover:text-text-secondary" aria-label="close">×</button>
      </div>
      {c.des && <p className="text-text-secondary leading-snug">{c.des}</p>}
      <div className="font-data text-text-dim">
        Out chance {(100 * c.p).toFixed(0)}% {"★".repeat(stars(c.p))} · his share {(100 * c.share).toFixed(0)}% · EV {c.ev ?? "—"} mph, LA {c.la ?? "—"}°
        {c.x != null && c.y != null ? ` · ${Math.round(Math.hypot(c.x, c.y))} ft out` : ""}
        {c.hr != null ? ` · HR in ${c.hr}/30 parks` : ""}
      </div>
      <div className="font-data">credit {signedFixed(c.credit, 2)} outs · <span className={signTone(c.runs)}>{signedFixed(c.runs, 2)} runs</span></div>
      <div className="flex flex-wrap gap-3 pt-0.5">
        {c.pid && <button type="button" onClick={() => setPlay(true)} className="underline text-text-primary">▶ Watch</button>}
        {c.pid && <a href={savantPlay(c.pid)} target="_blank" rel="noopener noreferrer" className="underline text-text-secondary">Savant video ↗</a>}
        {c.g && <Link href={`/games/${c.g}`} className="underline text-text-secondary">Game report</Link>}
        {c.g && <a href={savantFeed(c.g)} target="_blank" rel="noopener noreferrer" className="underline text-text-secondary">Savant game feed ↗</a>}
      </div>
      {play && c.pid && <Clip pid={c.pid} />}
    </div>
  );
}

/** Every chance where the ball was fielded or landed, on a to-scale field; hover to read, click to pin. */
function FieldDrill({ card, sel, setSel }: { card: Card; sel: Chance | null; setSel: (c: Chance | null) => void }) {
  const [show, setShow] = useState<"all" | "made" | "missed" | "hard">("all");
  const [hover, setHover] = useState<Chance | null>(null);
  const pts = card.chanceList.filter((c) => c.x != null && c.y != null &&
    (show === "all" || (show === "made" ? c.made : show === "missed" ? !c.made : hardest(c))));
  const chip = (on: boolean) => `px-2 py-0.5 rounded-md text-[10px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const cur = hover ?? sel;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {([["all", "All"], ["made", "Made"], ["missed", "Not made"], ["hard", "Made at < 50%"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={chip(show === k)} onClick={() => setShow(k)}>{l}</button>
        ))}
      </div>
      <BallField label={`${card.pos.toUpperCase()} chances on the field`} initial={card.group === "OF" ? "field" : "infield"}>
        {(s) => pts.map((c, i) => (
          <circle key={i} cx={c.x!} cy={-c.y!} r={(dotR(c) + (c === cur ? 2 : 0)) * 1.4 * s}
            fill={c.made ? MADE : MISSED} fillOpacity={0.25 + 0.6 * c.share}
            stroke={c === cur ? "#fff" : "rgba(0,0,0,0.45)"} strokeWidth={c === cur ? 1.5 : 0.5} vectorEffect="non-scaling-stroke"
            className="cursor-pointer" onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}
            onClick={(e) => { e.stopPropagation(); setSel(c); }}>
            <title>{tip(c)}</title>
          </circle>
        ))}
      </BallField>
      {cur && !sel && (
        <div className="text-[10px] text-text-dim font-data truncate">
          {cur.batter ? `${cur.batter} · ` : ""}{cur.event.replace(/_/g, " ")} · {(100 * cur.p).toFixed(0)}% · {signedFixed(cur.runs, 2)} runs — click to pin
        </div>
      )}
      {sel && <PlayDetail c={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function Plays({ card, setSel }: { card: Card; setSel: (c: Chance) => void }) {
  const top = [...card.chanceList].sort((a, b) => Math.abs(b.runs) - Math.abs(a.runs)).slice(0, 12);
  const best = card.chanceList.filter(hardest).sort((a, b) => a.p - b.p).slice(0, 5);
  const tiers = [1, 2, 3, 4, 5].map((s) => {
    const cs = card.chanceList.filter((c) => stars(c.p) === s);
    const w = cs.reduce((t, c) => t + c.share, 0);
    return { s, n: w, made: cs.filter((c) => c.made).reduce((t, c) => t + c.share, 0), exp: cs.reduce((t, c) => t + c.share * c.p, 0) };
  });
  const row = (c: Chance, i: number) => (
    <button key={i} type="button" onClick={() => setSel(c)} className="flex w-full items-center gap-2 text-left text-[11px] font-data hover:bg-white/[0.04] rounded" title={tip(c)}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.made ? MADE : MISSED }} />
      <span className="w-10 shrink-0 text-text-dim">{md(c.date)}</span>
      <span className="w-28 truncate text-text-secondary">{c.batter ?? c.event.replace(/_/g, " ")}</span>
      <span className="w-20 truncate text-text-dim">{c.event.replace(/_/g, " ")}</span>
      <span className="w-12 shrink-0 text-right text-text-dim">{(100 * c.p).toFixed(0)}%</span>
      <span className={`w-14 shrink-0 text-right ${signTone(c.runs)}`}>{signedFixed(c.runs, 2)}</span>
      <span className="w-4 shrink-0 text-text-dim">{c.pid ? "▶" : ""}</span>
    </button>
  );
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
      {best.length > 0 && <>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Hardest plays made · click to watch</div>
        {best.map(row)}
      </>}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Biggest plays (runs)</div>
      {top.map(row)}
    </div>
  );
}

function CardBody({ card }: { card: Card }) {
  const [sel, setSel] = useState<Chance | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,520px)_1fr]">
      <FieldDrill card={card} sel={sel} setSel={setSel} />
      <Plays card={card} setSel={setSel} />
    </div>
  );
}

type SavantBlk = {
  frv?: { total: number | null; range: number | null; arm: number | null; dp: number | null; rec1b: number | null;
    framing: number | null; throwing: number | null; blocking: number | null; outs: Record<string, number> };
  oaa?: { pos: string; oaa: number | null; front: number | null; to3b: number | null; to1b: number | null; back: number | null;
    rhh: number | null; lhh: number | null; success: string; expected: string };
  rec1bAll?: number[] | null;
};

/** Savant's own fielding numbers for the season, labelled: run value parts, directional OAA, 1B receiving. */
function SavantDefense({ b }: { b: SavantBlk }) {
  const f = b.frv, o = b.oaa;
  const parts = f ? ([["Range", f.range], ["Arm", f.arm], ["Double plays", f.dp], ["1B receiving", f.rec1b], ["Framing", f.framing],
    ["Throwing", f.throwing], ["Blocking", f.blocking]] as [string, number | null][]).filter(([, v]) => v != null) : [];
  const mx = Math.max(1, ...parts.map(([, v]) => Math.abs(v!)));
  const dir = (v: number | null) => (v == null ? "rgba(255,255,255,0.3)" : v > 0 ? MADE : v < 0 ? MISSED : "rgba(255,255,255,0.5)");
  const rec = b.rec1bAll && f?.rec1b != null ? b.rec1bAll : null;
  const rank = rec ? 1 + rec.filter((v) => v > f!.rec1b!).length : 0;
  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Savant fielding · reference</span>
        {f?.total != null && <span className={`font-data text-lg ${signTone(f.total)}`}>{signedFixed(f.total, 1)} runs</span>}
        {f && <span className="text-[11px] text-text-dim">outs at {Object.entries(f.outs).map(([p, n]) => `${p.toUpperCase()} ${n.toLocaleString("en-US")}`).join(" · ")}</span>}
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {parts.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-text-dim">Fielding run value by part</div>
            {parts.map(([l, v]) => (
              <div key={l} className="flex items-center gap-2 text-[11px] font-data" title={`${l}: ${signedFixed(v, 2)} runs (Savant)`}>
                <span className="w-24 text-text-secondary font-sans">{l}</span>
                <span className="relative h-2 w-28 bg-white/[0.04] rounded">
                  <span className="absolute top-0 h-2 rounded" style={{ background: dir(v), left: v! >= 0 ? "50%" : `${50 - (50 * Math.abs(v!)) / mx}%`, width: `${(50 * Math.abs(v!)) / mx}%` }} />
                  <span className="absolute left-1/2 top-[-2px] h-3 w-px bg-white/30" />
                </span>
                <span className={signTone(v!)}>{signedFixed(v, 1)}</span>
              </div>
            ))}
          </div>
        )}
        {o && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-dim">Outs above average by direction · {o.pos}</div>
            <svg viewBox="-60 -50 120 100" className="w-full max-w-[200px]" role="img" aria-label="OAA by direction of the play">
              <circle cx={0} cy={0} r={8} fill="rgba(255,255,255,0.12)" />
              {([["back", 0, -30, "back"], ["front", 0, 30, "in"], ["to3b", -38, 0, "→3B"], ["to1b", 38, 0, "→1B"]] as const).map(([k, x, y, l]) => {
                const v = o[k];
                return (
                  <g key={k}>
                    <line x1={0} y1={0} x2={x * 0.55} y2={y * 0.55} stroke={dir(v)} strokeWidth={3} />
                    <text x={x} y={y + 3} fontSize={9} textAnchor="middle" fill={dir(v)}>{v == null ? "—" : signedFixed(v, 0)}</text>
                    <text x={x} y={y + 12} fontSize={6.5} textAnchor="middle" fill="rgba(255,255,255,0.45)">{l}</text>
                  </g>
                );
              })}
            </svg>
            <div className="text-[11px] font-data text-text-dim">vs RHH {signedFixed(o.rhh, 0)} · vs LHH {signedFixed(o.lhh, 0)} · success {o.success} (exp {o.expected})</div>
          </div>
        )}
        {rec && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-dim">1B receiving · every first baseman</div>
            <svg viewBox="0 0 220 46" className="w-full max-w-[260px]" role="img" aria-label="1B receiving runs, all first basemen">
              {(() => {
                const lo = Math.min(...rec), hi = Math.max(...rec), X = (v: number) => 8 + ((v - lo) / (hi - lo || 1)) * 204;
                return <>
                  <line x1={X(0)} x2={X(0)} y1={6} y2={34} stroke="rgba(255,255,255,0.25)" />
                  {rec.map((v, i) => <circle key={i} cx={X(v)} cy={20 + ((i * 7) % 11) - 5} r={2} fill="rgba(255,255,255,0.3)"><title>{signedFixed(v, 2)} runs</title></circle>)}
                  <circle cx={X(f!.rec1b!)} cy={20} r={4.5} fill={dir(f!.rec1b)} stroke="#fff" strokeWidth={1} />
                  <text x={8} y={44} fontSize={8} fill="rgba(255,255,255,0.45)">{signedFixed(lo, 1)}</text>
                  <text x={212} y={44} fontSize={8} textAnchor="end" fill="rgba(255,255,255,0.45)">{signedFixed(hi, 1)}</text>
                </>;
              })()}
            </svg>
            <div className="text-[11px] font-data text-text-dim">{signedFixed(f!.rec1b, 2)} runs on throws received · #{rank} of {rec.length}</div>
          </div>
        )}
      </div>
      <p className="text-[10px] text-text-dim">Savant&apos;s published season numbers, shown as reference beside the site model. 1B receiving is runs saved on throws a first baseman picks or scoops; Savant publishes the season total only, not each play.</p>
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
  if (!d || (!d.cards?.length && !d.catcher && !d.savant))
    return <div className="glass-panel p-4 text-xs text-text-dim">No site defense grade for {season}: under the sample floor, or a position whose model did not pass its gate (see the glossary). Savant&apos;s numbers are on the Savant tab.</div>;
  const c: Catcher | null = d.catcher;
  return (
    <div className="space-y-5">
      {d.savant && <SavantDefense b={d.savant} />}
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
          <CardBody card={k} />
        </div>
      ))}
      <p className="text-[11px] text-text-dim">Site models refit on Statcast (RESULTS-MLB §75/§76/§80/§81). Runs are vs an average fielder at the position, shrunk by measured reliability; Savant&apos;s own numbers sit on the Savant tab for comparison.</p>
    </div>
  );
}
