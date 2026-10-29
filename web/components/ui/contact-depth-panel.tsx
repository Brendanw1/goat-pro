"use client";

/**
 * Contact-depth explorer, hitter side (RESULTS-MLB §89; bake pipeline/contact_depth.py). Lives in the Swing tab.
 * Competitive swings with contact (foul + in play) only: Statcast's intercept on a whiff is a projection, not contact.
 * Depth is measured from the batter, so it carries his stance; curves use depth centred on his own season mean.
 * §89 failed: a hitter's own damage window is not a stable trait, so his curve is drawn over the league's, never as his.
 */
import { useEffect, useMemo, useState } from "react";
import { ordinal, percentileColor, percentileRamp } from "@/lib/percentiles";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

const GOLD = "#e3b341", GREY = "#8b93a7", DIM = "#5d6577";
const BIN_X: Record<string, number> = { "8+ deep": -11, "4-8 deep": -6, "0-4 deep": -2, "0-4 front": 2, "4-8 front": 6, "8+ front": 11 };
const VB = [[0, 85, "<85"], [85, 90, "85–90"], [90, 95, "90–95"], [95, 200, "95+"]] as const;
const PT_NAME: Record<string, string> = { FF: "four-seamers", SI: "sinkers", CT: "cutters", SL: "sliders", SW: "sweepers", CB: "curveballs", CH: "changeups", FS: "splitters" };
const evColor = (ev: number) => percentileRamp((ev - 70) / 38);
const binPhrase = (b: string) => { const [r, w] = b.split(" "); return `${r.replace("-", "–")} in. ${w === "deep" ? "deeper than" : "in front of"}`; };
const inch = (v: number, dp = 1) => `${Math.abs(v).toFixed(dp)} in.`;

type Pt = { y: number; x: number | null; dc: number; ev: number | null; xw: number | null; pt: string | null; v: number; k2: boolean; day: number; L: boolean; pid: string; th: "L" | "R" };
type Hand = "all" | "R" | "L";
type SortKey = "name" | "th" | "n" | "nBip" | "dc" | "ev" | "xw";

function unpack(p: any, codes: string[]): Pt[] {
  return p.y.map((y: number, i: number) => ({
    y: y / 10, x: p.x[i] <= -9000 ? null : p.x[i] / 10, dc: p.dc[i] / 10,
    ev: p.ev[i] < 0 ? null : p.ev[i], xw: p.xw[i] < 0 ? null : p.xw[i] / 1000,
    pt: p.pt[i] >= 0 ? codes[p.pt[i]] : null, v: p.v[i] / 10, k2: !!p.k2[i], day: p.day[i], L: !!p.side[i],
    pid: String(p.pid?.[i] ?? ""), th: p.th?.[i] ? "L" : "R",
  }));
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const BIN_LABELS = Object.keys(BIN_X);
const binOf = (dc: number) => (dc <= -8 ? 0 : dc <= -4 ? 1 : dc <= 0 ? 2 : dc <= 4 ? 3 : dc <= 8 ? 4 : 5);  // as the bake's pd.cut

/** His xwOBAcon by centred-depth bin for any subset of balls in play. */
function hisBins(pts: Pt[]) {
  const acc = BIN_LABELS.map(() => ({ s: 0, n: 0 }));
  for (const p of pts) if (p.xw != null) { const b = acc[binOf(p.dc)]; b.s += p.xw; b.n++; }
  return BIN_LABELS.map((bin, i) => ({ bin, n: acc[i].n, xw: acc[i].n ? acc[i].s / acc[i].n : null }));
}

/** Rolling mean of centred depth over the subset (pts are in game order), 95% band, at most 150 points. */
function rollOf(pts: Pt[]): { roll: number[][]; w: number } {
  const n = pts.length;
  const w = n >= 150 ? 50 : Math.max(15, Math.floor(n / 3));
  if (n < 30) return { roll: [], w };
  const out: number[][] = [];
  const step = Math.max(1, Math.floor((n - w + 1) / 150));
  for (let i = w - 1; i < n; i += step) {
    const win = pts.slice(i - w + 1, i + 1).map((p) => p.dc);
    const m = mean(win), sd = Math.sqrt(mean(win.map((v) => (v - m) ** 2)));
    out.push([pts[i].day, Math.round(m * 10) / 10, Math.round((19.6 * sd) / Math.sqrt(w)) / 10]);
  }
  return { roll: out, w };
}

const CHIP = "px-2 py-0.5 rounded-md text-[11px] border transition-colors";
const chipCls = (on: boolean) => `${CHIP} ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;

function Card({ title, read, n, children }: { title: string; read: string; n: string; children: React.ReactNode }) {
  return (
    <figure className="glass-panel p-3 flex flex-col">
      <figcaption className="mb-1.5">
        <div className="text-[13px] font-semibold text-text-primary leading-snug">{title}</div>
        <div className="text-[10px] text-text-dim">{n}</div>
      </figcaption>
      <div className="flex-1">{children}</div>
      <p className="mt-1.5 text-[11px] text-text-secondary leading-snug">{read}</p>
    </figure>
  );
}

function Chip({ label, value, pct, good }: { label: string; value: string; pct: number | null | undefined; good: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.06] px-2.5 py-1.5">
      <div className="text-[10px] text-text-dim">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-sm text-text-primary">{value}</span>
        {pct != null && (
          <span className="font-data text-[10px]" style={{ color: good ? percentileColor(pct) : GREY }}
            title={good ? "percentile, high = good for the hitter" : "percentile for context; a style, not good or bad"}>
            {ordinal(pct)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Top-down contact cloud in the batter's frame: x = distance from his body, y = toward the pitcher. Plate to scale. */
function Cloud({ pts, plate, side }: { pts: Pt[]; plate: any; side: string }) {
  const X0 = 0, X1 = 62, Y0 = -2, Y1 = 66, S = 5.2, P = 22;
  const W = (X1 - X0) * S + 2 * P, H = (Y1 - Y0) * S + 2 * P;
  const sx = (x: number) => P + (x - X0) * S, sy = (y: number) => H - P - (y - Y0) * S;
  const yf = plate.yFront, xc = plate.xCenter;
  const plateD = [[xc - 8.5, yf], [xc + 8.5, yf], [xc + 8.5, yf - 8.5], [xc, yf - 17], [xc - 8.5, yf - 8.5]]
    .map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("") + "Z";
  const shown = pts.filter((p) => p.x != null && p.x >= X0 && p.x <= X1 && p.y >= Y0 && p.y <= Y1);
  const my = mean(pts.map((p) => p.y));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[380px] mx-auto" role="img" aria-label="contact points from above">
      <path d={plateD} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
      <text x={sx(xc)} y={sy(yf - 9)} textAnchor="middle" fontSize={8} fill={GREY}>plate</text>
      {[0, 20, 40, 60].map((v) => (
        <g key={v}>
          <line x1={P} x2={W - P} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,0.05)" />
          <text x={P - 4} y={sy(v) + 3} textAnchor="end" fontSize={8} fill={DIM}>{v}</text>
        </g>
      ))}
      {shown.map((p, i) => (
        <circle key={i} cx={sx(p.x!)} cy={sy(p.y)} r={p.xw != null ? 2.3 : 1.6}
          fill={p.ev != null ? evColor(p.ev) : GREY} opacity={p.xw != null ? 0.85 : 0.4} />
      ))}
      <line x1={P} x2={W - P} y1={sy(my)} y2={sy(my)} stroke={GOLD} strokeDasharray="4 3" />
      <text x={W - P} y={sy(my) - 4} textAnchor="end" fontSize={9} fill={GOLD}>his mean {my.toFixed(1)}</text>
      <line x1={P} x2={W - P} y1={sy(yf)} y2={sy(yf)} stroke="rgba(255,255,255,0.25)" strokeDasharray="1 3" />
      <text x={P + 2} y={sy(yf) - 4} fontSize={8} fill={GREY}>front of plate</text>
      <circle cx={sx(0)} cy={sy(0)} r={4} fill="none" stroke={GREY} />
      <text x={sx(0) + 7} y={sy(0) + 3} fontSize={8} fill={GREY}>batter ({side}HB)</text>
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={8} fill={DIM}>in. from his body, toward the plate →</text>
      <text x={8} y={H / 2} fontSize={8} fill={DIM} transform={`rotate(-90 8 ${H / 2})`} textAnchor="middle">in. out front of him (toward the pitcher) →</text>
    </svg>
  );
}

/** His xwOBAcon by depth bin (centred on his mean) over the league curve moved to his level. */
function DamageCurve({ his, league, peak }: { his: any[]; league: { grid: number[]; xw: number[] }; peak: number }) {
  const W = 420, H = 230, PL = 36, PR = 10, PT = 12, PB = 28;
  const pts = his.filter((b) => b.n >= 8 && b.xw != null);
  const nTot = his.reduce((s, b) => s + b.n, 0);
  const hisMean = his.reduce((s, b) => s + (b.xw ?? 0) * b.n, 0) / Math.max(nTot, 1);
  const lgMean = mean(his.map((b) => league.xw[league.grid.indexOf(BIN_X[b.bin])] ?? NaN).filter(Number.isFinite));
  const shift = Number.isFinite(lgMean) ? hisMean - lgMean : 0;
  const ys = [...pts.map((b) => b.xw), ...league.xw.map((v) => v + shift)];
  const y0 = Math.max(0, Math.min(...ys) - 0.05), y1 = Math.max(...ys) + 0.05;
  const sx = (v: number) => PL + ((v + 14) / 28) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const line = league.grid.map((g, i) => ({ g, v: league.xw[i] + shift })).filter((p) => p.g >= -14 && p.g <= 14)
    .map((p, i) => `${i ? "L" : "M"}${sx(p.g).toFixed(1)},${sy(p.v).toFixed(1)}`).join("");
  const maxN = Math.max(...pts.map((b) => b.n), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="damage by contact depth">
      <rect x={sx(0)} y={PT} width={sx(8) - sx(0)} height={H - PT - PB} fill="rgba(227,179,65,0.06)" />
      <text x={(sx(0) + sx(8)) / 2} y={PT + 9} textAnchor="middle" fontSize={8} fill={GOLD} opacity={0.8}>league sweet spot</text>
      <line x1={sx(0)} x2={sx(0)} y1={PT} y2={H - PB} stroke="rgba(255,255,255,0.15)" />
      <path d={line} fill="none" stroke={GREY} strokeWidth={1.6} strokeDasharray="5 3" />
      <text x={sx(peak)} y={sy(league.xw[league.grid.indexOf(peak)] + shift) - 6} textAnchor="middle" fontSize={8} fill={GREY}>league peak +{peak}</text>
      {pts.map((b) => (
        <g key={b.bin}>
          <circle cx={sx(BIN_X[b.bin])} cy={sy(b.xw)} r={3 + 5 * Math.sqrt(b.n / maxN)} fill={GOLD} opacity={0.8} />
          <text x={sx(BIN_X[b.bin])} y={sy(b.xw) + 16} textAnchor="middle" fontSize={8} fill={DIM}>n {b.n}</text>
        </g>
      ))}
      {[y0, (y0 + y1) / 2, y1].map((v) => (
        <text key={v} x={PL - 4} y={sy(v) + 3} textAnchor="end" fontSize={8} fill={DIM}>{v.toFixed(3).replace(/^0/, "")}</text>
      ))}
      {[-12, -8, -4, 0, 4, 8, 12].map((v) => (
        <text key={v} x={sx(v)} y={H - PB + 11} textAnchor="middle" fontSize={8} fill={DIM}>{v > 0 ? `+${v}` : v}</text>
      ))}
      <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize={8} fill={DIM}>in. vs his own mean depth (− deeper, + out front)</text>
    </svg>
  );
}

/** Small multiples: where he meets each pitch type, one row per velo band, raw depth from his body. */
function TypeStrips({ pts, plateFront }: { pts: Pt[]; plateFront: number }) {
  const types = Object.keys(PT_NAME).map((t) => ({ t, p: pts.filter((q) => q.pt === t) })).filter((g) => g.p.length >= 15);
  const W = 230, RH = 14, P = 8, D0 = 0, D1 = 60;
  const sx = (v: number) => P + ((Math.max(D0, Math.min(D1, v)) - D0) / (D1 - D0)) * (W - 2 * P);
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {types.map(({ t, p }) => {
        const bands = VB.map(([lo, hi, lab]) => ({ lab, p: p.filter((q) => q.v >= lo && q.v < hi) })).filter((b) => b.p.length >= 5);
        const color = PITCH_CONFIG[t as PitchType]?.color ?? GREY;
        const H = bands.length * RH + 16;
        return (
          <div key={t} className="rounded-md border border-white/[0.05] p-1.5">
            <div className="flex items-baseline justify-between text-[10px]">
              <span style={{ color }}>{PITCH_CONFIG[t as PitchType]?.label ?? t}</span>
              <span className="font-data text-text-dim">n {p.length} · mean {mean(p.map((q) => q.y)).toFixed(1)}</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${t} contact depth by velocity`}>
              <line x1={sx(plateFront)} x2={sx(plateFront)} y1={0} y2={H - 14} stroke="rgba(255,255,255,0.2)" strokeDasharray="1 2" />
              {bands.map((b, r) => {
                const m = mean(b.p.map((q) => q.y));
                return (
                  <g key={b.lab}>
                    {b.p.map((q, i) => <circle key={i} cx={sx(q.y)} cy={r * RH + 7 + ((i * 7) % 5) - 2} r={1.4} fill={color} opacity={0.45} />)}
                    <line x1={sx(m)} x2={sx(m)} y1={r * RH + 1} y2={r * RH + 13} stroke="#fff" strokeWidth={1.6} />
                    <text x={W - P} y={r * RH + 10} textAnchor="end" fontSize={7} fill={DIM}>{b.lab} ({b.p.length})</text>
                  </g>
                );
              })}
              {[0, 20, 40, 60].map((v) => <text key={v} x={sx(v)} y={H - 3} textAnchor="middle" fontSize={7} fill={DIM}>{v}</text>)}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/** Rolling 50-contact centred depth with a 95% band, over the league's weekly within-hitter drift. */
function Rolling({ roll, week }: { roll: number[][]; week: any[] }) {
  const W = 760, H = 170, PL = 30, PR = 10, PT = 10, PB = 24;
  const d0 = Math.min(roll[0][0], ...(week ?? []).map((w) => w.w * 7)), d1 = Math.max(roll[roll.length - 1][0], 200);
  const ys = roll.flatMap((r) => [r[1] - r[2], r[1] + r[2]]);
  const lim = Math.max(3, ...ys.map(Math.abs)) + 0.5;
  const sx = (v: number) => PL + ((v - d0) / (d1 - d0)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v + lim) / (2 * lim)) * (H - PT - PB);
  const band = roll.map((r) => `${sx(r[0])},${sy(r[1] + r[2])}`).join(" ") + " " +
    [...roll].reverse().map((r) => `${sx(r[0])},${sy(r[1] - r[2])}`).join(" ");
  const ln = roll.map((r, i) => `${i ? "L" : "M"}${sx(r[0]).toFixed(1)},${sy(r[1]).toFixed(1)}`).join("");
  const lg = (week ?? []).map((w, i) => `${i ? "L" : "M"}${sx(w.w * 7 + 3).toFixed(1)},${sy(w.dc).toFixed(1)}`).join("");
  const months = [["Apr", 17], ["May", 47], ["Jun", 78], ["Jul", 108], ["Aug", 139], ["Sep", 170]] as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="rolling contact depth">
      <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.15)" />
      <polygon points={band} fill={GOLD} opacity={0.14} />
      <path d={lg} fill="none" stroke={GREY} strokeWidth={1.2} strokeDasharray="4 3" />
      <path d={ln} fill="none" stroke={GOLD} strokeWidth={1.8} />
      {[-lim + 0.5, 0, lim - 0.5].map((v) => (
        <text key={v} x={PL - 4} y={sy(v) + 3} textAnchor="end" fontSize={8} fill={DIM}>{v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)}</text>
      ))}
      {months.map(([m, d]) => d >= d0 && d <= d1 && (
        <text key={m} x={sx(d)} y={H - 6} textAnchor="middle" fontSize={8} fill={DIM}>{m}</text>
      ))}
      <text x={W - PR} y={sy(lim - 0.5) + 3} textAnchor="end" fontSize={8} fill={DIM}>out front ↑ · deeper ↓ (in., vs his season mean)</text>
    </svg>
  );
}

export function ContactDepthPanel({ id, season }: { id: string | number; season: string | number }) {
  const [d, setD] = useState<any | null | undefined>(undefined);
  const [lg, setLg] = useState<any | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [hand, setHand] = useState<Hand>("all");
  const [pitcher, setPitcher] = useState<string>("");
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "n", desc: true });
  useEffect(() => {
    let live = true;
    setD(undefined);
    setTypes([]); setHand("all"); setPitcher("");
    fetch(`/api/data/depth/${id}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((x) => live && setD(x)).catch(() => live && setD(null));
    fetch(`/api/data/depth/league`).then((r) => (r.ok ? r.json() : null)).then((x) => live && setLg(x)).catch(() => {});
    return () => { live = false; };
  }, [id, season]);
  const pts = useMemo(() => (d ? unpack(d.pts, d.ptCodes) : []), [d]);
  // type + hand filter feeds the pitcher list and table; the pitcher pick narrows every chart further
  const th = useMemo(() => pts.filter((p) => (!types.length || (p.pt && types.includes(p.pt))) && (hand === "all" || p.th === hand)), [pts, types, hand]);
  const shown = useMemo(() => (pitcher ? th.filter((p) => p.pid === pitcher) : th), [th, pitcher]);
  const byPitcher = useMemo(() => {
    const m = new Map<string, Pt[]>();
    for (const p of th) m.set(p.pid, [...(m.get(p.pid) ?? []), p]);
    return [...m.entries()].map(([pid, ps]) => {
      const b = ps.filter((p) => p.xw != null);
      return { pid, name: d?.pitchers?.[pid] ?? pid, th: ps[0].th, n: ps.length, nBip: b.length, dc: mean(ps.map((p) => p.dc)),
        ev: b.length ? mean(b.filter((p) => p.ev != null).map((p) => p.ev!)) : NaN, xw: b.length ? mean(b.map((p) => p.xw!)) : NaN };
    });
  }, [th, d]);
  if (d === undefined) return <div className="h-40 animate-pulse rounded-lg bg-white/[0.03]" />;
  if (!d) return (
    <div className="glass-panel p-4 text-xs text-text-dim">
      No contact-depth file for {season}. It covers 2024–26 and needs 100 competitive swings.
    </div>
  );
  const s = d.summary, pc = d.pct ?? {};
  const curve = lg?.curve;
  const gate = lg?.gate?.main;
  const havePid = Array.isArray(d.pts?.pid);
  const typesFaced = Object.keys(PT_NAME).filter((t) => pts.some((p) => p.pt === t));
  const pName = pitcher ? d.pitchers?.[pitcher] ?? pitcher : null;
  const subset = [
    types.length ? `on ${types.map((t) => PT_NAME[t]).join(", ")}` : null,
    hand !== "all" ? `vs ${hand}HP` : null,
    pName ? `vs ${pName}` : null,
  ].filter(Boolean).join(" · ");
  const tag = (t: string) => (subset ? `${t} (${subset})` : t);
  const main = shown.filter((p) => p.L === (d.side === "L"));
  const mainBip = main.filter((p) => p.xw != null).length;
  const bip = shown.filter((p) => p.xw != null);
  const his = hisBins(shown);
  const vsPlate = main.length ? mean(main.map((p) => p.y)) - d.plate.yFront : s.depth - d.plate.yFront;
  const best = his.filter((b) => b.n >= 15 && b.xw != null).sort((a, b) => b.xw! - a.xw!)[0];
  const byType = Object.keys(PT_NAME).map((t) => ({ t, p: shown.filter((q) => q.pt === t) })).filter((g) => g.p.length >= 15)
    .map((g) => ({ t: g.t, m: mean(g.p.map((q) => q.y)), n: g.p.length })).sort((a, b) => a.m - b.m);
  const deep = byType[0], front = byType[byType.length - 1];
  const { roll, w } = rollOf(shown);
  const k = Math.max(1, Math.floor(roll.length / 6));
  const drift = roll.length > 2 * k ? mean(roll.slice(-k).map((r) => r[1])) - mean(roll.slice(0, k).map((r) => r[1])) : null;
  const k2 = shown.filter((p) => p.k2), k0 = shown.filter((p) => !p.k2);
  const k2gap = k2.length >= 30 && k0.length >= 30 ? mean(k2.map((p) => p.dc)) - mean(k0.map((p) => p.dc)) : null;
  const pitchersFaced = [...byPitcher].sort((a, b) => b.n - a.n);
  const tableRows = [...byPitcher].filter((r) => r.n >= 3).sort((a, b) => {
    const va = a[sort.k], vb = b[sort.k];
    const c = typeof va === "string" ? String(va).localeCompare(String(vb)) : (Number.isFinite(va as number) ? (va as number) : -1e9) - (Number.isFinite(vb as number) ? (vb as number) : -1e9);
    return sort.desc ? -c : c;
  });
  const sortBy = (k: SortKey) => setSort((o) => ({ k, desc: o.k === k ? !o.desc : k !== "name" && k !== "th" }));
  const Th = ({ k: key, label, right = true }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`py-1 font-semibold ${right ? "text-right" : "text-left"}`} aria-sort={sort.k === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => sortBy(key)} className="uppercase tracking-wider hover:text-text-primary">
        {label}{sort.k === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3).replace(/^0/, "") : "—");
  const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Where he meets the ball · {d.season}</h3>
        <span className="text-[10px] text-text-dim">
          {d.n.toLocaleString()} contacts ({d.nBip} in play) on competitive swings · whiffs left out (their intercept is a projection)
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chip label="Contact depth (from his body), season" value={`${s.depth}"`} pct={pc.depth} good={false} />
        <Chip label="xwOBA on contact, season" value={s.xw != null ? s.xw.toFixed(3).replace(/^0/, "") : "—"} pct={pc.xw} good />
        <Chip label="Exit velo in play, season" value={s.ev != null ? `${s.ev}` : "—"} pct={pc.ev} good />
        <Chip label="Depth vs league on 95+ fastballs" value={s.late != null ? `${s.late > 0 ? "+" : ""}${s.late}"` : "—"} pct={pc.late} good={false} />
      </div>

      <div className="glass-panel p-3 space-y-2" role="group" aria-label="filter contacts">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-text-dim mr-1">Pitch type</span>
          <button type="button" className={chipCls(!types.length)} aria-pressed={!types.length} onClick={() => setTypes([])}>All</button>
          {typesFaced.map((t) => {
            const on = types.includes(t);
            return (
              <button key={t} type="button" aria-pressed={on} className={chipCls(on)}
                style={on ? { borderColor: PITCH_CONFIG[t as PitchType]?.color } : undefined}
                onClick={() => setTypes((o) => (on ? o.filter((x) => x !== t) : [...o, t]))}>
                {PITCH_CONFIG[t as PitchType]?.label ?? t} <span className="font-data text-text-dim">{pts.filter((p) => p.pt === t).length}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-text-dim mr-1">Pitcher hand</span>
          {(["all", "R", "L"] as Hand[]).map((h) => (
            <button key={h} type="button" aria-pressed={hand === h} className={chipCls(hand === h)} onClick={() => setHand(h)}>
              {h === "all" ? "Both" : `vs ${h}HP`}
            </button>
          ))}
          {havePid && (
            <label className="ml-2 flex items-center gap-1.5 text-[10px] text-text-dim">
              Pitcher
              <select value={pitcher} onChange={(e) => setPitcher(e.target.value)}
                className="rounded-md border border-border-subtle bg-black/40 px-2 py-0.5 text-[11px] text-text-secondary max-w-[240px]">
                <option value="">All {pitchersFaced.length} pitchers</option>
                {pitchersFaced.map((r) => <option key={r.pid} value={r.pid}>{r.name} ({r.th}) · {r.n}</option>)}
              </select>
            </label>
          )}
          {(types.length > 0 || hand !== "all" || pitcher) && (
            <button type="button" className="ml-auto text-[10px] text-text-dim underline" onClick={() => { setTypes([]); setHand("all"); setPitcher(""); }}>Clear filters</button>
          )}
        </div>
        <div className="text-[10px] text-text-dim">
          Showing <span className="font-data text-text-secondary">{shown.length}</span> of {pts.length} contacts ({bip.length} in play){subset ? ` · ${subset}` : ""}. Season chips above ignore the filter.
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="glass-panel p-4 text-xs text-text-dim">No contacts match these filters. Clear one to see his contact points.</div>
      ) : (<>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title={tag(`He meets the ball ${inch(vsPlate)} ${vsPlate >= 0 ? "in front of" : "behind"} the front of the plate`)}
          n={`${main.length} contacts as a ${d.side}HB (${mainBip} in play) · coloured by exit velo (fouls faint)`}
          read={`Seen from above, in his own frame: 0 is his body, up is toward the pitcher. The plate is placed from ${d.plate.src === "savant" ? "his Savant stance position this season" : "the league-average stance (Savant has no stance position before 2025)"}.`}>
          <Cloud pts={main} plate={d.plate} side={d.side} />
          <div className="mt-1 flex items-center justify-center gap-1 text-[9px] text-text-dim">
            <span>70 mph</span>
            {[70, 80, 90, 100, 108].map((v) => <span key={v} className="inline-block h-2 w-5" style={{ background: evColor(v) }} />)}
            <span>108+</span>
          </div>
        </Card>
        {curve && bip.length >= 8 && (
          <Card
            title={tag(best ? `His best bin was ${binPhrase(best.bin)} his normal; the league peaks ${curve.peak} in. out front` : `The league does its damage ${curve.peak} in. out front of normal`)}
            n={`${bip.length} balls in play in 6 bins (bins under 8 hidden) · league curve from ${lg.n_bip?.toLocaleString()} balls, moved to his level`}
            read={`His own peak is noise, not a trait: split halves of each hitter's best depth agree at r ${gate?.r_split ?? ".12"} (Spearman-Brown ${gate?.sb ?? ".21"}, §89), and the league curve predicts his held-out balls better. Read the dashed line; a filtered subset is noisier still.`}>
            <DamageCurve his={his} league={curve} peak={curve.peak} />
          </Card>
        )}
      </div>

      {deep && (
        <Card
          title={tag(front && deep.t !== front.t
            ? `He meets ${PT_NAME[front.t]} ${inch(front.m - deep.m)} further out front than ${PT_NAME[deep.t]}`
            : `He meets ${PT_NAME[deep.t]} ${deep.m.toFixed(1)} in. out from his body`)}
          n={`${byType.reduce((a, b) => a + b.n, 0)} contacts on types with 15+ · rows = pitch velo band (n) · white tick = mean · dotted = front of plate`}
          read="Slower pitches get met further out front for nearly every hitter; the gap between bands is the velocity effect, the gap between panels is the pitch type.">
          <TypeStrips pts={shown} plateFront={d.plate.yFront} />
        </Card>
      )}

      {roll.length > 2 ? (
        <Card
          title={tag(drift == null || Math.abs(drift) < 1 ? `His contact point held within an inch all season` : `His contact point moved ${inch(drift)} ${drift > 0 ? "out front" : "deeper"} from his first contacts to his last`)}
          n={`${shown.length} contacts · rolling ${w}, 95% band · dashed = league weekly within-hitter drift${k2gap != null ? ` · with two strikes he meets it ${inch(k2gap)} ${k2gap < 0 ? "deeper" : "further out front"}` : ""}`}
          read="The league line barely moves (±0.2 in. by month): any swing in his line bigger than the band is him, not the calendar.">
          <Rolling roll={roll} week={lg?.week?.[String(d.season)] ?? []} />
        </Card>
      ) : (
        <div className="glass-panel p-3 text-[11px] text-text-dim">The rolling trend needs 30+ contacts in the subset ({shown.length} now).</div>
      )}
      </>)}

      {havePid && (
        <figure className="glass-panel p-3 overflow-x-auto">
          <figcaption className="mb-1.5">
            <div className="text-[13px] font-semibold text-text-primary leading-snug">
              {(() => {
                const t = tableRows.length ? `He made the most contact against ${[...byPitcher].sort((a, b) => b.n - a.n)[0].name}` : "Contact by pitcher";
                const sub = [types.length ? `on ${types.map((x) => PT_NAME[x]).join(", ")}` : null, hand !== "all" ? `vs ${hand}HP` : null].filter(Boolean).join(" · ");
                return sub ? `${t} (${sub})` : t;  // the table follows type + hand, not the pitcher pick
              })()}
            </div>
            <div className="text-[10px] text-text-dim">{tableRows.length} pitchers with 3+ contacts · click a header to sort, again to flip · depth vs his own season mean (+ out front)</div>
          </figcaption>
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] text-text-dim">
                <Th k="name" label="Pitcher" right={false} />
                <Th k="th" label="Hand" right={false} />
                <Th k="n" label="Contacts" />
                <Th k="nBip" label="In play" />
                <Th k="dc" label="Depth vs norm" />
                <Th k="ev" label="EV" />
                <Th k="xw" label="xwOBAcon" />
              </tr>
            </thead>
            <tbody>
              {tableRows.slice(0, 30).map((r) => (
                <tr key={r.pid} className={`border-t border-white/[0.04] ${r.pid === pitcher ? "bg-white/[0.04]" : ""}`}>
                  <td className="py-1 font-sans"><a href={`/player/${r.pid}`} className="text-text-secondary hover:underline">{r.name}</a></td>
                  <td className="py-1 text-text-dim">{r.th}HP</td>
                  <td className="py-1 text-right">{r.n}</td>
                  <td className="py-1 text-right text-text-dim">{r.nBip}</td>
                  <td className="py-1 text-right text-text-primary">{Number.isFinite(r.dc) ? `${r.dc > 0 ? "+" : ""}${r.dc.toFixed(1)}` : "—"}</td>
                  <td className="py-1 text-right">{f1(r.ev)}</td>
                  <td className="py-1 text-right">{f3(r.xw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] text-text-secondary">A handful of contacts per pitcher is a description of what happened, not a matchup read. Top 30 by the current sort.</p>
        </figure>
      )}
      <p className="text-[10px] text-text-dim leading-relaxed max-w-[95ch]">
        Statcast&apos;s intercept point, measured from the batter, so raw depth includes where he stands; every curve centres it on
        his own season mean per batting side. Contact depth and depth vs league on 95+ are styles: ranked for context, not
        coloured. Descriptive, not a forecast. <a className="underline" href="/depth">League contact depth</a>.
      </p>
    </section>
  );
}
