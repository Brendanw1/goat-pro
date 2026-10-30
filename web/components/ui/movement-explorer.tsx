"use client";

/**
 * Movement explorer (D-10): every pitch's shape, hb × ivb, across his seasons at this level.
 * Data is already baked per player-season (the pitch explorer's files: `t`, `v`, `iv`, `hb`, ints ×10),
 * so this only fetches. League density is the stride sample in movement_league.json (the pitches
 * family bakes it): grey ghost dots behind his, per type, so "where the league lives" is visible
 * next to where his shapes sit. Shapes moved between seasons read as clusters that jump.
 */
import { useEffect, useMemo, useState } from "react";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

type File = { season: number; types: string[]; t: number[]; v: number[]; iv: number[]; hb: number[] };
type League = { season: number; types: Record<string, { hb: number[]; iv: number[]; n: number }> };

const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";
const chip = (on: boolean) =>
  `rounded-md border px-2 py-0.5 ${on ? "border-usf-green/30 bg-usf-green/20 text-usf-gold" : "border-border-subtle text-text-secondary"}`;
const i1 = (v: number) => (v / 10).toFixed(1);

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const W = 460, H = 380, PAD = 38;
const HB_LO = -28, HB_HI = 28, IV_LO = -28, IV_HI = 32; // inches
const sx = (v: number) => PAD + ((v - HB_LO) / (HB_HI - HB_LO)) * (W - 2 * PAD);
const sy = (v: number) => H - PAD - ((v - IV_LO) / (IV_HI - IV_LO)) * (H - 2 * PAD);

export function MovementExplorer({ id, season, level, seasons }: {
  id: string;
  season: number;
  level?: string;
  /** seasons he has at this level, newest last (career.seasons `s` fields) */
  seasons: number[];
}) {
  // the three most recent seasons, latest first in the UI
  const list = useMemo(() => seasons.filter((s) => s <= season).slice(-3).reverse(), [seasons, season]);
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [league, setLeague] = useState<Record<number, League | null>>({});
  const [showLeague, setShowLeague] = useState(true);
  const [active, setActive] = useState<number>(season);
  const [types, setTypes] = useState<string[]>([]);
  const [type, setType] = useState<string>("all");

  useEffect(() => {
    let dead = false;
    for (const s of list) {
      if (s in files) continue;
      getJson<File>(`/api/data/pitches/${id}?side=P&season=${s}&level=${level ?? "mlb"}`).then((f) => {
        if (!dead) setFiles((prev) => ({ ...prev, [s]: f }));
      });
      if (!(s in league)) {
        getJson<League>(`/api/data/movement-league?season=${s}&level=${level ?? "mlb"}`).then((l) => {
          if (!dead) setLeague((prev) => ({ ...prev, [s]: l }));
        });
      }
    }
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, level, list.join(",")]);

  const hisTypes = useMemo(() => {
    const f = files[active];
    if (!f?.t || !f.types) return [];
    return [...new Set(f.t)].map((i) => f.types[i]).sort();
  }, [files, active]);
  useEffect(() => { setTypes(hisTypes); if (!hisTypes.includes(type)) setType("all"); }, [hisTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (f: File) => f.t.map((ti, i) => ({ t: f.types[ti] ?? "?", i }))
    .filter(({ t }) => type === "all" || t === type)
    .map(({ t, i }) => ({ t, hb: f.hb[i] / 10, iv: f.iv[i] / 10, v: f.v[i] / 10 }))
    .filter((p) => p.hb >= HB_LO && p.hb <= HB_HI && p.iv >= IV_LO && p.iv <= IV_HI);
  const meanOf = (f: File) => {
    const pts = shown(f);
    if (!pts.length) return null;
    return { hb: pts.reduce((s, p) => s + p.hb, 0) / pts.length, iv: pts.reduce((s, p) => s + p.iv, 0) / pts.length, n: pts.length };
  };

  if (!list.length) return <p className="text-[11px] text-text-dim">No pitch files at this level yet.</p>;
  const activeFile = files[active];
  const lg = showLeague ? league[active] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px]">
        <div className="flex gap-1" role="group" aria-label="Season">
          {list.map((s) => <button key={s} type="button" aria-pressed={active === s} onClick={() => setActive(s)} className={chip(active === s)}>{s}</button>)}
        </div>
        {hisTypes.length > 0 && (
          <div className="flex gap-1" role="group" aria-label="Pitch type">
            <button type="button" aria-pressed={type === "all"} onClick={() => setType("all")} className={chip(type === "all")}>All</button>
            {hisTypes.map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={chip(type === t)}>
                {PITCH_CONFIG[t as PitchType]?.shortLabel ?? t}
              </button>
            ))}
          </div>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1 text-text-dim">
          <input type="checkbox" checked={showLeague} onChange={(e) => setShowLeague(e.target.checked)} className="accent-usf-gold" />
          league dots
        </label>
        <span className="text-text-dim">{activeFile ? `${shown(activeFile).length} pitches` : "loading…"}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px] h-auto" role="img" aria-label="Pitch movement by season, horizontal break by induced vertical break">
        <line x1={sx(HB_LO)} y1={sy(0)} x2={sx(HB_HI)} y2={sy(0)} stroke="currentColor" className="text-border-subtle" />
        <line x1={sx(0)} y1={sy(IV_LO)} x2={sx(0)} y2={sy(IV_HI)} stroke="currentColor" className="text-border-subtle" />
        {/* league ghost dots, this season, filtered to the chosen type when one is picked */}
        {lg && Object.entries(lg.types).filter(([t]) => type === "all" || t === type).map(([t, d]) =>
          d.hb.map((hb, i) => (
            <circle key={`${t}-${i}`} cx={sx(hb / 10)} cy={sy(d.iv[i] / 10)} r={1.6} fill={colorOf(t)} fillOpacity={0.14} />
          )),
        )}
        {/* his dots */}
        {activeFile && shown(activeFile).map((p, i) => (
          <circle key={i} cx={sx(p.hb)} cy={sy(p.iv)} r={2.6} fill={colorOf(p.t)} fillOpacity={0.5}>
            <title>{`${p.t} ${active}: ${i1(p.v * 10)} mph · ${p.iv > 0 ? "+" : ""}${p.iv.toFixed(1)} IVB · ${p.hb > 0 ? "+" : ""}${p.hb.toFixed(1)} HB`}</title>
          </circle>
        ))}
        {/* per-season means of the chosen type, so drift reads without squinting */}
        {type !== "all" && list.map((s) => {
          const f = files[s];
          const m = f ? meanOf(f) : null;
          if (!m) return null;
          const isA = s === active;
          return (
            <g key={m.n * 0 + s}>
              <path d={`M ${sx(m.hb) - 4} ${sy(m.iv)} H ${sx(m.hb) + 4} M ${sx(m.hb)} ${sy(m.iv) - 4} V ${sy(m.iv) + 4}`}
                stroke={colorOf(type)} strokeOpacity={isA ? 0.95 : 0.4} strokeWidth={isA ? 1.6 : 1.1} />
              <text x={sx(m.hb) + 6} y={sy(m.iv) - 5} fontSize={8.5} fill={colorOf(type)} fillOpacity={isA ? 0.95 : 0.4}>{s}</text>
            </g>
          );
        })}
        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-text-dim" fontSize="9" letterSpacing="0.08em">GLOVE ← HB (IN) → ARM</text>
        <text x={12} y={H / 2} className="fill-text-dim" fontSize="9" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">← IVB (IN)</text>
      </svg>
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim">
        Every pitch at this level, arm-side break across and induced vertical break up (Statcast pfx, inches).
        Faint dots are a sample of the league&apos;s pitches that season, same type — his clusters read against where
        the league lives. Pick one type for its per-season mean (+): a mean that moves is a grip or seam change;
        a cluster that splits is a new shape wearing an old name. League sample is baked, not modelled.
      </p>
    </div>
  );
}
