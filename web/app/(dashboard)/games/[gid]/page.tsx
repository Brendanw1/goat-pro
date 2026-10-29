import Link from "next/link";
import { getGameReport, getGameWpa } from "@/lib/data";
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
  const wpa = await getGameWpa(gid, level);
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

  // D-22: who faced whom — per batter × per pitcher, PAs and hits from the PA
  // table (1B/2B/3B/HR are the hits; a sacrifice still counts as a PA).
  const HITS = new Set(["1B", "2B", "3B", "HR"]);
  const matchup: Record<string, Record<string, { pa: number; h: number }>> = {};
  for (const pa of g.pas ?? []) {
    const bk = String(pa.bt), pk = String(pa.pt);
    matchup[bk] ??= {};
    matchup[bk][pk] ??= { pa: 0, h: 0 };
    matchup[bk][pk].pa += 1;
    if (HITS.has(pa.r)) matchup[bk][pk].h += 1;
  }
  const pitchersFaced = (g.p ?? []).filter((p: any) => Object.values(matchup).some((m) => m[p.id]));
  const battersByTeam = new Map<string, any[]>();
  for (const b of g.b ?? []) {
    battersByTeam.get(b.tm)?.push(b) ?? battersByTeam.set(b.tm, [b]);
  }

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

      {wpa?.timeline?.length ? (
        <div className="glass-panel p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Win probability</span>
            <span className="text-[10px] text-text-dim">{wpa.home} win expectancy by inning — the swings below are the batting team&apos;s</span>
          </div>
          <svg viewBox="0 0 940 120" className="w-full" role="img" aria-label="home win probability by inning">
            {(() => {
              const W = 940, H = 120, PL = 8, PR = 8, PT = 10, PB = 16;
              const pts = wpa.timeline;
              const px = (i: number) => PL + (i / Math.max(1, pts.length - 1)) * (W - PL - PR);
              const py = (v: number) => PT + (1 - Math.max(0, Math.min(1, v))) * (H - PT - PB);
              const path = pts.map((p0: any, i: number) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(p0.homeWe).toFixed(1)}`).join("");
              return (
                <>
                  <line x1={PL} y1={py(0.5)} x2={W - PR} y2={py(0.5)} stroke="#8b93a7" strokeWidth={0.6} strokeDasharray="3 3" opacity={0.5} />
                  <path d={path} fill="none" stroke="#e3b341" strokeWidth={1.8} />
                  {pts.map((p0: any, i: number) => (
                    <text key={i} x={px(i)} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#8b93a7">{p0.inning}</text>
                  ))}
                </>
              );
            })()}
          </svg>
          {wpa.moments?.length ? (
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {wpa.moments.slice(0, 6).map((m: any, i: number) => (
                <div key={i} className="flex items-baseline gap-2 text-[11px] border-b border-white/[0.03] py-1">
                  <span className="font-data text-text-dim shrink-0">{m.half === "Bot" ? "B" : "T"}{m.inning}</span>
                  <span className="text-text-secondary leading-snug flex-1">
                    <Link href={`/player/${m.batterId}`} className="hover:underline">{m.batter}</Link>
                    {" — "}{m.des}
                  </span>
                  <span className="font-data shrink-0" style={{ color: (m.swing ?? 0) > 0 ? "#5ba88f" : "#e0654f" }}>
                    {(m.swing ?? 0) > 0 ? "+" : ""}{m.swing?.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
          {[...battersByTeam.entries()].map(([tm, rows]) => (
            <div key={tm}>
              <div className="px-4 py-1 bg-white/[0.02] text-[10px] font-semibold uppercase tracking-wider text-usf-gold/80">{tm}</div>
              <div className="overflow-x-auto"><div className="min-w-max">
                {rows.map((b: any) => (
                  <div key={b.id} className="flex items-center px-4 border-b border-white/[0.025]" style={{ height: "30px" }}>
                    <div className="w-[150px] text-xs">
                      <Link href={`/player/${b.id}?season=${String(g.d).slice(0, 4)}`} className="text-text-primary hover:underline">{b.n ?? b.id}</Link>
                    </div>
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
          ))}
          <div className="px-4 py-1.5 text-[9px] text-text-dim border-t border-border-subtle">
            columns: PA · H · HR · BB · K · avg EV
          </div>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Matchup matrix</span>
          <span className="text-[10px] text-text-dim">each hitter against each pitcher he faced — PA, hits</span>
        </div>
        <div className="overflow-x-auto"><div className="min-w-max px-4 py-2">
          <table className="text-[10px] font-data border-collapse">
            <thead>
              <tr>
                <th className="text-left pr-3 text-text-dim uppercase tracking-wider text-[9px] font-semibold">Hitter</th>
                {pitchersFaced.map((p: any) => (
                  <th key={p.id} className="px-1.5 pb-1 font-data" style={{ color: "var(--text-secondary)" }} title={p.n ?? p.id}>
                    {p.n?.split(" ").pop() ?? p.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(g.b ?? []).map((b: any) => (
                <tr key={b.id}>
                  <td className="pr-3 text-text-secondary truncate max-w-[130px]">{b.n ?? b.id}</td>
                  {pitchersFaced.map((p: any) => {
                    const m = matchup[b.id]?.[p.id];
                    return (
                      <td key={p.id} className="px-0.5 py-0.5">
                        <div title={`${b.n ?? b.id} vs ${p.n ?? p.id}: ${m?.pa ?? 0} PA, ${m?.h ?? 0} for ${m?.h ?? 0}`}
                          className="flex items-center justify-center rounded-[3px] min-w-[40px] h-[20px]"
                          style={{ background: m ? (m.h > 0 ? "rgba(63,191,95,0.25)" : "rgba(255,255,255,0.03)") : "transparent" }}>
                          {m ? <span className={m.h > 0 ? "text-usf-green" : "text-text-dim"}>{m.pa}{m.h > 0 ? `·${m.h}` : ""}</span> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
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
