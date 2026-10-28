import Link from "next/link";
import { getGameReport } from "@/lib/data";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

export const dynamic = "force-dynamic";

/**
 * A game report (R2, wave 10): the box score and everything that happened in
 * it, from the bake's per-game file — both teams' pitching lines (runs charged
 * to the pitcher on the mound when the runner scored, the site's RE24-style
 * attribution), both teams' batting lines, and the full plate-appearance table
 * with each pitch of each PA. A record, ungated: if a name is missing it is
 * because the park didn't track him, not because he was excluded.
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
  HR: "text-usf-gold font-semibold",
  "1B": "text-usf-green", "2B": "text-usf-green", "3B": "text-usf-green",
  BB: "text-text-secondary", IBB: "text-text-secondary", HBP: "text-text-secondary",
  K: "text-[#e0654f]", KD: "text-[#e0654f]",
  E: "text-[#e0b14f]",
};

const outsWord = (o: number) => (o === 1 ? "1 out" : o === 2 ? "2 out" : "no out");
const basesWord = (b: number) => {
  const on = [b & 1 ? "1st" : null, b & 2 ? "2nd" : null, b & 4 ? "3rd" : null].filter(Boolean);
  return on.length ? ` · on ${on.join(", ")}` : " · bases empty";
};

const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";

export default async function GameReportPage({ params, searchParams }: {
  params: Promise<{ gid: string }>;
  searchParams?: Promise<{ level?: string }>;
}) {
  const { gid } = await params;
  const level = (await searchParams)?.level === "aaa" ? "aaa" : "mlb";
  const g = await getGameReport(gid, level);
  if (!g) {
    return (
      <div className="glass-panel p-8 text-center text-sm text-text-dim">
        No game report for {gid}.{level === "aaa" ? " (AAA)" : ""}
      </div>
    );
  }
  const names: Record<string, string> = {};
  for (const p of g.p ?? []) names[p.id] = p.n ?? p.id;
  for (const b of g.b ?? []) names[b.id] = b.n ?? b.id;
  const [hs, as_] = Array.isArray(g.final) ? g.final : [0, 0];
  const awayWon = as_ > hs;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            {g.away} {as_} — {hs} {g.home}
          </h1>
          <p className="text-xs text-text-dim">
            {g.d} · {awayWon ? `${g.away} win` : `${g.home} win`} · {g.pas?.length ?? 0} plate appearances
            {level === "aaa" ? " · AAA" : ""}
          </p>
        </div>
        <Link href={level === "aaa" ? "/minors" : "/pitchers"} className="text-[11px] text-text-dim hover:text-text-secondary">← Back</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Pitching</span>
            <span className="text-[10px] text-text-dim ml-2">runs charge to the pitcher on the mound when the runner scores</span>
          </div>
          <div className="overflow-x-auto"><div className="min-w-max">
            <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
              <div className="w-[150px]">Pitcher</div><div className="w-[36px] text-right">TM</div>
              <div className="w-[44px] text-right">IP</div><div className="w-[32px] text-right">H</div>
              <div className="w-[32px] text-right">R</div><div className="w-[36px] text-right">BB</div>
              <div className="w-[32px] text-right">K</div><div className="w-[32px] text-right">HR</div>
              <div className="w-[36px] text-right">BF</div><div className="w-[40px] text-right">P</div>
            </div>
            {(g.p ?? []).map((p: any) => (
              <div key={p.id} className="flex items-center px-4 border-b border-white/[0.025]" style={{ height: "30px" }}>
                <div className="w-[150px] text-xs">
                  <Link href={`/player/${p.id}?season=${String(g.d).slice(0, 4)}`} className="text-text-primary hover:underline">{p.n ?? p.id}</Link>
                </div>
                <div className="w-[36px] text-right text-xs font-data text-text-dim">{p.tm}</div>
                <div className="w-[44px] text-right text-xs font-data text-text-primary">{p.ip}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-secondary">{p.h}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-secondary">{p.r}</div>
                <div className="w-[36px] text-right text-xs font-data text-text-secondary">{p.bb}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-primary">{p.k}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-secondary">{p.hr}</div>
                <div className="w-[36px] text-right text-xs font-data text-text-dim">{p.bf}</div>
                <div className="w-[40px] text-right text-xs font-data text-text-dim">{p.pc}</div>
              </div>
            ))}
          </div></div>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Batting</span>
          </div>
          <div className="overflow-x-auto"><div className="min-w-max">
            <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
              <div className="w-[150px]">Hitter</div><div className="w-[36px] text-right">TM</div>
              <div className="w-[36px] text-right">PA</div><div className="w-[32px] text-right">H</div>
              <div className="w-[32px] text-right">HR</div>
              <div className="w-[36px] text-right">BB</div><div className="w-[32px] text-right">K</div>
              <div className="w-[52px] text-right">Avg EV</div>
            </div>
            {(g.b ?? []).map((b: any) => (
              <div key={b.id} className="flex items-center px-4 border-b border-white/[0.025]" style={{ height: "30px" }}>
                <div className="w-[150px] text-xs">
                  <Link href={`/player/${b.id}?season=${String(g.d).slice(0, 4)}`} className="text-text-primary hover:underline">{b.n ?? b.id}</Link>
                </div>
                <div className="w-[36px] text-right text-xs font-data text-text-dim">{b.tm}</div>
                <div className="w-[36px] text-right text-xs font-data text-text-primary">{b.pa}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-secondary">{b.h}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-primary">{b.hr}</div>
                <div className="w-[36px] text-right text-xs font-data text-text-secondary">{b.bb}</div>
                <div className="w-[32px] text-right text-xs font-data text-text-secondary">{b.k}</div>
                <div className="w-[52px] text-right text-xs font-data text-text-dim">{b.ev ?? "—"}</div>
              </div>
            ))}
          </div></div>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Plate appearances</span>
          <span className="text-[10px] text-text-dim">
            every recorded pitch · B ball · C called · S whiff · T tip · F foul · X in play
          </span>
        </div>
        <div className="overflow-x-auto"><div className="min-w-max">
          <div className="flex items-center px-4 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-dim">
            <div className="w-[46px]">Inn</div>
            <div className="w-[128px]">Situation</div>
            <div className="w-[170px]">Matchup</div>
            <div className="w-[46px] text-right">Result</div>
            <div className="w-[54px] text-right">Score</div>
            <div className="pl-3">Pitches</div>
          </div>
          {(g.pas ?? []).map((pa: any, i: number) => (
            <div key={i} className={`flex items-center px-4 py-1 ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`}>
              <div className="w-[46px] text-[11px] font-data text-text-secondary">{pa.h === "t" ? "Top" : "Bot"} {pa.i}</div>
              <div className="w-[128px] text-[10px] text-text-dim truncate" title={`${outsWord(pa.o)}${basesWord(pa.b)}`}>
                {outsWord(pa.o)}{basesWord(pa.b)}
              </div>
              <div className="w-[170px] text-[10px] text-text-secondary truncate"
                title={`${names[String(pa.bt)] ?? pa.bt} vs ${names[String(pa.pt)] ?? pa.pt}`}>
                {names[String(pa.bt)] ?? pa.bt} <span className="text-text-dim">vs</span> {names[String(pa.pt)] ?? pa.pt}
              </div>
              <div className={`w-[46px] text-right text-[11px] font-data ${RESULT_STYLE[pa.r] ?? "text-text-secondary"}`}>{pa.r}</div>
              <div className="w-[54px] text-right text-[10px] font-data text-text-dim" title="home–away after the PA">
                {Array.isArray(pa.s) ? `${pa.s[0]}–${pa.s[1]}` : "—"}
              </div>
              <div className="pl-3 flex items-center gap-[3px] flex-wrap">
                {(pa.p ?? []).map((pch: any, j: number) => {
                  const st = PITCH_STYLE[String(pch[2])] ?? PITCH_STYLE["?"];
                  return (
                    <span key={j} title={`${pch[0]}${typeof pch[1] === "number" ? ` ${pch[1].toFixed(1)} mph` : ""} — ${st.tip}`}
                      className="inline-flex items-center justify-center rounded-[3px] font-data text-[9px] leading-none text-text-primary/90"
                      style={{ background: st.bg, minWidth: "17px", height: "15px", padding: "0 2px", color: colorOf(pch[0]) }}>
                      {pch[2]}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div></div>
      </div>
    </div>
  );
}
