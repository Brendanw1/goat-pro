import Link from "next/link";
import { getGameReport } from "@/lib/data";
import { PITCH_CONFIG } from "@/lib/constants";
import { PrintButton } from "@/components/ui/print-button";
import type { PitchType } from "@/types";

export const dynamic = "force-dynamic";

/**
 * The per-game player report (D-21 remainder): one printable page where every
 * player in the game gets his own block — hitters their plate appearances with
 * each pitch, pitchers their line and what they threw. Joins the bake's game
 * file (lines + the PA table) with nothing else: a record of the game, ungated.
 * The pitch-call chips and situation words mirror the game page's table.
 */

const PITCH_STYLE: Record<string, { bg: string; tip: string }> = {
  B: { bg: "rgba(148,163,184,0.30)", tip: "ball" },
  C: { bg: "rgba(59,158,255,0.38)", tip: "called strike" },
  S: { bg: "rgba(255,77,77,0.45)", tip: "swinging strike" },
  T: { bg: "rgba(255,217,61,0.35)", tip: "foul tip" },
  F: { bg: "rgba(255,217,61,0.22)", tip: "foul" },
  M: { bg: "rgba(139,147,163,0.30)", tip: "missed bunt" },
  P: { bg: "rgba(232,119,34,0.40)", tip: "hit by pitch" },
  X: { bg: "rgba(63,191,95,0.30)", tip: "in play" },
  "?": { bg: "rgba(255,255,255,0.10)", tip: "other" },
};
const RESULT_STYLE: Record<string, string> = {
  HR: "text-usf-gold font-semibold", "1B": "text-usf-green", "2B": "text-usf-green", "3B": "text-usf-green",
  BB: "text-text-secondary", IBB: "text-text-secondary", HBP: "text-text-secondary",
  K: "text-[#e0654f]", KD: "text-[#e0654f]", E: "text-[#e0b14f]",
};
const outsWord = (o: number) => (o === 1 ? "1 out" : o === 2 ? "2 out" : "no out");
const basesWord = (b: number) => {
  const on = [b & 1 ? "1st" : null, b & 2 ? "2nd" : null, b & 4 ? "3rd" : null].filter(Boolean);
  return on.length ? ` · on ${on.join(", ")}` : " · bases empty";
};
const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";

function PitchChips({ pitches }: { pitches: any[] }) {
  return (
    <span className="flex flex-wrap items-center gap-[3px]">
      {(pitches ?? []).map((pch: any, j: number) => {
        const st = PITCH_STYLE[String(pch[2])] ?? PITCH_STYLE["?"];
        return (
          <span key={j} title={`${pch[0]}${typeof pch[1] === "number" ? ` ${pch[1].toFixed(1)} mph` : ""} — ${st.tip}`}
            className="inline-flex items-center justify-center rounded-[3px] font-data text-[9px] leading-none"
            style={{ background: st.bg, minWidth: "17px", height: "15px", padding: "0 2px", color: colorOf(pch[0]) }}>
            {pch[2]}
          </span>
        );
      })}
    </span>
  );
}

export default async function GamePlayerReportPage({ params, searchParams }: {
  params: Promise<{ gid: string }>;
  searchParams?: Promise<{ level?: string }>;
}) {
  const { gid } = await params;
  const level = (await searchParams)?.level === "aaa" ? "aaa" : "mlb";
  const g = await getGameReport(gid, level);
  if (!g) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">No game report for {gid}.</div>;
  }
  const names: Record<string, string> = {};
  for (const p of g.p ?? []) names[String(p.id)] = p.n ?? String(p.id);
  for (const b of g.b ?? []) names[String(b.id)] = b.n ?? String(b.id);
  const [hs, as_] = Array.isArray(g.final) ? g.final : [0, 0];

  const pas: any[] = g.pas ?? [];
  const byBatter: Record<string, any[]> = {};
  for (const pa of pas) {
    (byBatter[String(pa.bt)] ??= []).push(pa);
  }
  const byPitcher: Record<string, any[]> = {};
  for (const pa of pas) {
    (byPitcher[String(pa.pt)] ??= []).push(pa);
  }
  const pitchMix = (pid: string) => {
    const mix: Record<string, number> = {};
    for (const pa of byPitcher[pid] ?? []) for (const pch of pa.p ?? []) mix[pch[0]] = (mix[pch[0]] ?? 0) + 1;
    return Object.entries(mix).sort((a, b) => b[1] - a[1]);
  };

  const hitterBlock = (tm: string) => (
    <div className="glass-panel p-4 space-y-2.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{tm} hitters</h2>
      {(g.b ?? []).filter((b: any) => b.tm === tm).map((b: any) => {
        const mine = byBatter[String(b.id)] ?? [];
        if (!mine.length && !b.pa) return null;
        return (
          <div key={b.id} className="border-t border-white/[0.05] pt-2 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-text-primary">{b.n ?? b.id}</span>
              <span className="font-data text-[10px] text-text-dim">
                {b.pa ?? mine.length} PA · {b.h ?? 0} H · {b.hr ?? 0} HR · {b.bb ?? 0} BB · {b.k ?? 0} K
                {b.ev ? ` · ${b.ev} mph avg EV` : ""}
              </span>
            </div>
            {mine.map((pa, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 py-0.5 text-[11px]">
                <span className="w-[52px] shrink-0 font-data text-text-dim">{pa.h === "t" ? "Top" : "Bot"} {pa.i}</span>
                <span className="w-[130px] shrink-0 truncate text-[10px] text-text-dim" title={`${outsWord(pa.o)}${basesWord(pa.b)} · vs ${names[String(pa.pt)] ?? pa.pt}`}>
                  vs {names[String(pa.pt)] ?? pa.pt}
                </span>
                <span className={`w-[34px] shrink-0 text-right font-data ${RESULT_STYLE[pa.r] ?? "text-text-secondary"}`}>{pa.r}</span>
                <PitchChips pitches={pa.p ?? []} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );

  const pitcherBlock = (tm: string) => (
    <div className="glass-panel p-4 space-y-2.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{tm} pitchers</h2>
      {(g.p ?? []).filter((p: any) => p.tm === tm).map((p: any) => {
        const faced = byPitcher[String(p.id)] ?? [];
        const mix = pitchMix(String(p.id));
        return (
          <div key={p.id} className="border-t border-white/[0.05] pt-2 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-text-primary">{p.n ?? p.id}</span>
              <span className="font-data text-[10px] text-text-dim">
                {p.ip} IP · {p.h} H · {p.r} R · {p.bb} BB · {p.k} K · {p.pc ?? "—"} pitches
              </span>
            </div>
            <div className="text-[10px] text-text-dim">
              {mix.length ? mix.map(([t, n]) => (
                <span key={t} className="mr-2 inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: colorOf(t) }} />{t} {n}
                </span>
              )) : "no tracked pitches"}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-secondary">
              {faced.map((pa, i) => (
                <span key={i}>
                  {names[String(pa.bt)] ?? pa.bt}
                  {": "}
                  <span className={`font-data ${RESULT_STYLE[pa.r] ?? ""}`}>{pa.r}</span>
                  <span className="text-text-dim"> ({pa.h === "t" ? "T" : "B"}{pa.i})</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-[900px] mx-auto space-y-4 sheet-page">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link href={`/games/${gid}${level === "aaa" ? "?level=aaa" : ""}`} className="text-[11px] text-text-dim hover:text-text-secondary">← Game report</Link>
        <PrintButton />
      </div>
      <div className="glass-panel px-5 py-4">
        <h1 className="text-lg font-bold text-text-primary">
          {g.away} {as_} — {hs} {g.home}
        </h1>
        <p className="text-xs text-text-dim">
          {g.d} · per-player game report{level === "aaa" ? " · AAA" : ""}
          {g.series ? ` · ${g.series.label}${g.series.n ? ` game ${g.series.n}` : ""}` : ""} · goatpro.dev
        </p>
      </div>
      {!pas.length ? (
        <div className="glass-panel p-4 text-sm text-text-dim">No tracked plate appearances for this game yet.</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {hitterBlock(g.away)}
            {hitterBlock(g.home)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {pitcherBlock(g.away)}
            {pitcherBlock(g.home)}
          </div>
          <p className="text-[10px] leading-relaxed text-text-dim">
            Pitch chips: B ball · C called strike · S swinging strike · T foul tip · F foul · P hit batter · X in play.
            Situation is outs and runners when the PA started. A record of what was tracked, ungated — a missing name
            means the park didn&apos;t track him.
          </p>
        </>
      )}
    </div>
  );
}
