"use client";
/**
 * Profile splits and movement buckets, from the same per-pitch file as the pitch explorer (full season,
 * no explorer filters). Splits: vs each hand and by pitch family. PA-level stats (wOBA, xwOBA, xBA, xSLG,
 * K%, BB%) count a PA where its last pitch falls; xwOBA uses xwOBA on contact and the wOBA value of
 * walks / HBP / strikeouts, as Savant does; AB = PA − BB − HBP (sacrifices counted as AB, a small
 * difference). Buckets: league quintiles of velocity, IVB and arm-side HB per pitch type, fixed across
 * seasons; each row compares his line in the bucket with the league's.
 */
import { useState } from "react";
import Link from "next/link";
import { PITCH_CONFIG } from "@/lib/constants";
import { Signed } from "@/components/ui/shared-ui";
import type { PitchType } from "@/types";

type Num = number | null;
type BStat = { n: number; rv100: number; whiff: Num; xwcon: Num };
export type SplitFile = {
  side: "P" | "H"; season: number; types: string[]; t: number[]; h: number[]; o: number[]; r: number[];
  w: Num[]; q?: number[]; ba?: Num[]; sl?: Num[]; wp?: Num[]; pp?: Num[]; dv?: Num[]; dec?: { mu: number; sd: number };
  v?: Num[]; iv?: Num[]; hb?: Num[]; pe?: number[]; wv?: Num[];
  bins?: Record<string, Record<string, number[]>>; lg?: Record<string, Record<string, BStat[]>>;
};

const FAMILY: Record<string, string> = { FF: "Fastball", SI: "Fastball", CT: "Fastball", SL: "Breaking", SW: "Breaking", CB: "Breaking", CH: "Offspeed", FS: "Offspeed" };
const SWING = new Set([2, 3, 4, 5, 6, 7, 8]);
const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";
const x3 = (v: Num) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(3).replace(/^0/, "").replace(/^-0/, "-"));
const f = (v: Num, d: number) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(d));

function line(fl: SplitFile, ix: number[]) {
  const n = ix.length;
  let pa = 0, k = 0, bb = 0, hbp = 0, wn = 0, wsum = 0, xsum = 0, basum = 0, slsum = 0, sw = 0, wh = 0, ooz = 0, oozSw = 0, rv = 0;
  let dvs = 0, dvn = 0, wps = 0, wpn = 0, pps = 0, ppn = 0;
  for (const i of ix) {
    const o = fl.o[i];
    rv += fl.r[i];
    if (SWING.has(o)) { sw++; if (o === 2) wh++; }
    if (fl.q && fl.q[i] === 0) { ooz++; if (SWING.has(o)) oozSw++; }
    if (fl.dv?.[i] != null) { dvs += fl.dv[i]!; dvn++; }
    if (fl.wp?.[i] != null) { wps += fl.wp[i]!; wpn++; }
    if (fl.pp?.[i] != null) { pps += fl.pp[i]!; ppn++; }
    const pe = fl.pe?.[i] ?? 0;
    if (!pe) continue;
    pa++;
    if (pe === 1) k++;
    if (pe === 2) bb++;
    if (o === 9) hbp++;
    if (o >= 4 && o <= 8) { basum += (fl.ba?.[i] ?? 0) / 1000; slsum += (fl.sl?.[i] ?? 0) / 1000; }
    const wv = fl.wv?.[i];
    if (wv == null) continue;
    wn++; wsum += wv / 100;
    xsum += o >= 4 && o <= 8 && fl.w[i] != null ? fl.w[i]! / 1000 : wv / 100;
  }
  const ab = pa - bb - hbp;
  const drv100 = dvn ? (100 * dvs) / dvn / 1000 : null;
  return {
    n, pa, woba: wn ? wsum / wn : null, xwoba: wn ? xsum / wn : null, xba: ab > 0 ? basum / ab : null, xslg: ab > 0 ? slsum / ab : null,
    k: pa ? (100 * k) / pa : null, bb: pa ? (100 * bb) / pa : null, rv100: n ? rv / 10 / n : null,
    whiff: sw ? (100 * wh) / sw : null, chase: ooz ? (100 * oozSw) / ooz : null,
    dec: drv100 !== null && fl.dec ? 100 + (10 * (drv100 - fl.dec.mu)) / fl.dec.sd : null,
    whiffPlus: wpn ? Math.min(175, Math.max(50, wps / wpn / 10)) : null, pitchingPlus: ppn ? pps / ppn / 10 : null,
  };
}

function bucketLabel(e: number[], k: number, unit: string) {
  if (k === 0) return `< ${e[0]}${unit}`;
  if (k === e.length) return `${e[e.length - 1]}+${unit}`;
  return `${e[k - 1]}–${e[k]}${unit}`;
}

const AXES = [["v", "Velocity", " mph", 0], ["iv", "IVB", " in", 1], ["hb", "Arm-side HB", " in", 2]] as const;

export function PitchSplits({ file, level = "mlb" }: { file: SplitFile; level?: string }) {
  const pitcher = file.side === "P";
  const bucketTypes = file.types.filter((t) => file.bins?.[t]);
  const [bt, setBt] = useState(bucketTypes[0] ?? "");
  const [axKey, setAxKey] = useState<"v" | "iv" | "hb">("v");
  if (!file.pe) return null; // files baked before the splits columns

  const all = file.t.map((_, i) => i);
  const fam = (name: string) => all.filter((i) => FAMILY[file.types[file.t[i]]] === name);
  const rows: [string, number[]][] = [
    ["All", all],
    [pitcher ? "vs LHB" : "vs LHP", all.filter((i) => file.h[i] === 0)],
    [pitcher ? "vs RHB" : "vs RHP", all.filter((i) => file.h[i] === 1)],
    ["Fastballs", fam("Fastball")], ["Breaking", fam("Breaking")], ["Offspeed", fam("Offspeed")],
  ];
  const lines = rows.map(([label, ix]) => ({ label, ...line(file, ix) })).filter((r) => r.n > 0);
  type L = (typeof lines)[number];
  const cols: [string, (r: L) => React.ReactNode, string?][] = [
    ["Pitches", (r) => r.n], ["PA", (r) => r.pa],
    ["wOBA", (r) => x3(r.woba)], ["xwOBA", (r) => x3(r.xwoba), "xwOBA on contact plus the wOBA value of walks, HBP and strikeouts"],
    ["xBA", (r) => x3(r.xba)], ["xSLG", (r) => x3(r.xslg)], ["K%", (r) => f(r.k, 1)], ["BB%", (r) => f(r.bb, 1)],
    ["RV/100", (r) => <Signed v={r.rv100} dp={2} />, `${pitcher ? "pitcher" : "hitter"}-positive run value per 100 pitches`],
    ["Whiff%", (r) => f(r.whiff, 1)], ["Chase%", (r) => f(r.chase, 1)],
    ...(file.dv ? [["Decision+", (r: L) => f(r.dec, 0), "the swing-decision grade on this split's pitches, same season scale"] as [string, (r: L) => React.ReactNode, string]] : []),
    ...(file.wp ? [["Whiff+", (r: L) => f(r.whiffPlus, 0)], ["Pitching+", (r: L) => f(r.pitchingPlus, 0)]] as [string, (r: L) => React.ReactNode][] : []),
  ];

  const ax = AXES.find((a) => a[0] === axKey)!;
  const edges = file.bins?.[bt]?.[axKey] ?? [];
  const lg = file.lg?.[bt]?.[axKey] ?? [];
  const ti = file.types.indexOf(bt);
  const ofType = all.filter((i) => file.t[i] === ti);
  const raw = file[axKey] ?? [];
  const scale = 10;
  const binOf = (val: number) => { let k = 0; while (k < edges.length && val / scale >= edges[k]) k++; return k; };
  const brows = [...Array(edges.length + 1).keys()].map((k) => {
    const ix = ofType.filter((i) => raw[i] != null && binOf(raw[i]!) === k);
    const l = line(file, ix);
    const xw = ix.map((i) => file.w[i]).filter((v): v is number => v != null);
    const lgRow = lg[k];
    const lgRv = lgRow ? (pitcher ? lgRow.rv100 : -lgRow.rv100) : null;
    return { k, label: bucketLabel(edges, k, ax[2]), n: ix.length, share: ofType.length ? (100 * ix.length) / ofType.length : null,
      rv100: l.rv100, whiff: l.whiff, xwcon: xw.length >= 5 ? xw.reduce((a, b) => a + b, 0) / xw.length / 1000 : null,
      lgRv, lgWhiff: lgRow?.whiff ?? null, lgXw: lgRow?.xwcon ?? null, lgShare: lgRow ? lgRow.n : null };
  });
  const lgTot = brows.reduce((a, r) => a + (r.lgShare ?? 0), 0);
  const chip = (on: boolean) => `px-2 py-0.5 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Splits — full season, by {pitcher ? "batter" : "pitcher"} hand and pitch family</p>
        <div className="overflow-x-auto">
          <table className="text-[11px] font-data">
            <thead className="text-text-dim"><tr>
              <th className="pr-3 text-left font-normal">Split</th>
              {cols.map(([h, , tip]) => <th key={h} title={tip} className="pr-3 text-right font-normal">{h}</th>)}
            </tr></thead>
            <tbody>{lines.map((r) => (
              <tr key={r.label} className={r.label === "All" ? "text-text-primary border-b border-border-subtle" : "text-text-secondary"}>
                <td className="pr-3">{r.label}</td>
                {cols.map(([h, g]) => <td key={h} className="pr-3 text-right">{g(r)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-[10px] text-text-dim mt-1">PA stats count a PA where its last pitch falls (a 2-strike breaking ball that ends it counts under Breaking). AB = PA − BB − HBP.</p>
      </div>
      {bucketTypes.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">
            Movement buckets — {pitcher ? "how his pitches play by shape" : "how he does against each shape (stuff faced)"}
          </p>
          <div className="flex flex-wrap items-center gap-1 mb-1">
            {bucketTypes.map((t) => (
              <button key={t} type="button" onClick={() => setBt(t)} aria-pressed={t === bt} className={chip(t === bt)}>
                <span style={{ color: colorOf(t) }}>●</span> {t}
              </button>
            ))}
            <span className="w-px h-4 bg-border-subtle mx-1" />
            {AXES.map(([k, l]) => <button key={k} type="button" onClick={() => setAxKey(k)} aria-pressed={k === axKey} className={chip(k === axKey)}>{l}</button>)}
          </div>
          <div className="overflow-x-auto">
            <table className="text-[11px] font-data">
              <thead className="text-text-dim"><tr>
                <th className="pr-3 text-left font-normal">{bt} {ax[1]}</th>
                <th className="pr-3 text-right font-normal">Pitches</th>
                <th className="pr-3 text-right font-normal" title={`share of the ${bt}s he ${pitcher ? "threw" : "saw"}; league share beside it`}>Share (lg)</th>
                <th className="pr-3 text-right font-normal">RV/100</th>
                <th className="pr-3 text-right font-normal" title="league RV/100 in this bucket, from his side">Lg RV/100</th>
                <th className="pr-3 text-right font-normal">Whiff% (lg)</th>
                <th className="pr-3 text-right font-normal">xwOBAcon (lg)</th>
                <th className="pr-3 text-right font-normal" />
              </tr></thead>
              <tbody>{brows.map((r) => (
                <tr key={r.k} className={r.n ? "text-text-secondary" : "text-text-dim"}>
                  <td className="pr-3">{r.label}</td>
                  <td className="pr-3 text-right">{r.n}</td>
                  <td className="pr-3 text-right">{f(r.share, 0)}% <span className="text-text-dim">({lgTot ? f((100 * (r.lgShare ?? 0)) / lgTot, 0) : "—"}%)</span></td>
                  <td className="pr-3 text-right">{r.n >= 15 ? <Signed v={r.rv100} dp={2} /> : "—"}</td>
                  <td className="pr-3 text-right text-text-dim">{f(r.lgRv, 2)}</td>
                  <td className="pr-3 text-right">{r.n >= 15 ? f(r.whiff, 1) : "—"} <span className="text-text-dim">({f(r.lgWhiff, 1)})</span></td>
                  <td className="pr-3 text-right">{r.n >= 15 ? x3(r.xwcon) : "—"} <span className="text-text-dim">({x3(r.lgXw)})</span></td>
                  <td className="pr-3 text-right">
                    <Link href={`/buckets?season=${file.season}&type=${bt}&axis=${axKey}&bin=${r.k}&side=${pitcher ? "pitchers" : "hitters"}${level === "aaa" ? "&level=aaa" : ""}`}
                      className="text-text-dim hover:text-text-secondary underline-offset-2 hover:underline">board →</Link>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-[10px] text-text-dim mt-1">
            Buckets are league quintiles of each pitch type&rsquo;s {ax[1].toLowerCase()} over the baked seasons, rounded; arm-side HB is
            positive toward the pitcher&rsquo;s arm side for both hands. Rates show from 15 pitches in a bucket, xwOBAcon from 5 balls in play. Descriptive.
          </p>
        </div>
      )}
    </div>
  );
}
