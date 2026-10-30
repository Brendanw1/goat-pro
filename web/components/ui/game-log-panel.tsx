"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtIp } from "@/lib/ip";
import { gradeColor } from "@/lib/grades";

/**
 * The game-log tab (wave 2c): one measured line per game, both sides. A
 * record of what happened, in order — no grades, no colour. The pitcher's
 * runs column charges runs to the pitcher who was on the mound when the
 * runner scored (the site's RE24-style attribution), so inherited runners
 * show up where they belong.
 *
 * Wave 6: a game row expands into its plate appearances — the ordered pitch
 * sequence (type, velocity, one-letter result) plus the situation the PA
 * started in and the event that ended it. Sequences load once, lazily, from
 * the per-player pa_log file; no expand affordance when playerId is absent.
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

/** The event that ended the PA, emphasised when it changed the scoreboard. */
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

function PaTable({ pas }: { pas: any[] }) {
  return (
    <div className="overflow-x-auto"><div className="min-w-max">
      <div className="flex items-center px-4 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-dim">
        <div className="w-[46px]">Inn</div>
        <div className="w-[128px]">Situation</div>
        <div className="w-[46px] text-right">Result</div>
        <div className="w-[54px] text-right">Score</div>
        <div className="pl-3">Pitches <span className="normal-case font-normal">(B ball · C called · S whiff · T tip · F foul · X in play)</span></div>
      </div>
      {pas.map((pa, i) => {
        const chips = Array.isArray(pa.p) ? pa.p : [];
        return (
          <div key={i} className={`flex items-center px-4 py-1 ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`}>
            <div className="w-[46px] text-[11px] font-data text-text-secondary">{pa.h === "t" ? "Top" : "Bot"} {pa.i}</div>
            <div className="w-[128px] text-[10px] text-text-dim truncate" title={`${outsWord(pa.o)}${basesWord(pa.b)}`}>
              {outsWord(pa.o)}{basesWord(pa.b)}
            </div>
            <div className={`w-[46px] text-right text-[11px] font-data ${RESULT_STYLE[pa.r] ?? "text-text-secondary"}`}>{pa.r}</div>
            <div className="w-[54px] text-right text-[10px] font-data text-text-dim" title="home–away after the PA">
              {Array.isArray(pa.s) ? `${pa.s[0]}–${pa.s[1]}` : "—"}
            </div>
            <div className="pl-3 flex items-center gap-[3px] flex-wrap">
              {chips.map((p: any, j: number) => {
                const st = PITCH_STYLE[String(p[2])] ?? PITCH_STYLE["?"];
                const label = `${p[0]}${typeof p[1] === "number" ? ` ${p[1].toFixed(1)} mph` : ""} — ${st.tip}`;
                return (
                  <span key={j} title={label}
                    className="inline-flex items-center justify-center rounded-[3px] font-data text-[9px] leading-none text-text-primary/90"
                    style={{ background: st.bg, minWidth: "17px", height: "15px", padding: "0 2px" }}>
                    {p[2]}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      {!pas.length && <p className="px-4 py-2 text-[11px] text-text-dim">No counted pitches in this game.</p>}
    </div></div>
  );
}

export function GameLogPanel({ data, playerId, season, level }: {
  data: any | null;
  playerId?: string;
  season?: number | string;
  level?: string;
}) {
  const [paLog, setPaLog] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openGame, setOpenGame] = useState<number | null>(null);

  if (!data?.games?.length) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Game log</h2>
        <p className="text-[11px] text-text-dim">No game log for this player-season.</p>
      </div>
    );
  }
  const pitcher = data.side === "P";
  const games = [...data.games].reverse(); // most recent first

  const toggleGame = async (gk: number) => {
    if (openGame === gk) { setOpenGame(null); return; }
    setOpenGame(gk);
    if (!paLog && !loading && !failed && playerId && season != null) {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ season: String(season) });
        if (level && level !== "mlb") qs.set("level", level);
        if (!pitcher) qs.set("side", "H");
        const res = await fetch(`/api/data/palog/${playerId}?${qs}`);
        if (res.ok) setPaLog(await res.json());
        else setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
  };
  const openPas = openGame != null && paLog
    ? paLog.games?.find((g: any) => Number(g.k) === openGame)?.pas ?? null
    : null;

  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
          Game log · {data.season}
        </span>
        <span className="text-[10px] text-text-dim">
          {pitcher ? "runs charge to the pitcher on the mound when the runner scores" : "measured lines, most recent first"}
          {playerId && season != null ? " · expand a game for its pitch sequences" : ""}
        </span>
      </div>
      <div className="overflow-x-auto"><div className="min-w-max">
        <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
          <div className="w-[26px]" />
          <div className="w-[92px]">Date</div>
          <div className="w-[48px]">Opp</div>
          {pitcher ? (
            <>
              <div className="w-[44px] text-right">IP</div>
              <div className="w-[36px] text-right">H</div>
              <div className="w-[36px] text-right">R</div>
              <div className="w-[36px] text-right">BB</div>
              <div className="w-[36px] text-right">K</div>
              <div className="w-[36px] text-right">HR</div>
              <div className="w-[36px] text-right">BF</div>
              <div className="w-[44px] text-right">PCH</div>
              <div className="w-[54px] text-right" title="Outing+ (D-18): this outing's mean Pitching+ vs the season's 15+ pitch outings, 100+10z. Descriptive.">Outing+</div>
              <div className="w-[54px] text-right" title="The outing's mean Whiff+ over graded pitches (100 = average).">Whf+</div>
            </>
          ) : (
            <>
              <div className="w-[36px] text-right">PA</div>
              <div className="w-[36px] text-right">H</div>
              <div className="w-[36px] text-right">HR</div>
              <div className="w-[36px] text-right">BB</div>
              <div className="w-[36px] text-right">K</div>
              <div className="w-[52px] text-right">Avg EV</div>
              <div className="w-[44px] text-right">HH</div>
            </>
          )}
        </div>
        {games.map((g: any, i: number) => {
          const gk = typeof g.g === "number" ? g.g : Number(g.g);
          const open = openGame === gk;
          return (
            <div key={`${g.d}-${gk ?? i}`}>
              <div className={`flex items-center px-4 border-b border-white/[0.025] ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`} style={{ height: "32px" }}>
                <div className="w-[26px]">
                  {playerId && season != null && Number.isFinite(gk) ? (
                    <button
                      onClick={() => toggleGame(gk)}
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${g.d} vs ${g.o}`}
                      className="text-text-dim hover:text-text-secondary transition-colors text-[10px] leading-none"
                    >
                      {open ? "▼" : "▶"}
                    </button>
                  ) : null}
                </div>
                <div className="w-[92px] text-xs font-data text-text-secondary">
                  {playerId && season != null && Number.isFinite(gk) ? (
                    <Link href={`/games/${gk}${level && level !== "mlb" ? "?level=aaa" : ""}`}
                      className="hover:text-usf-gold hover:underline" title="Game report">
                      {g.d}
                    </Link>
                  ) : g.d}
                </div>
                <div className="w-[48px] text-xs font-data text-text-secondary">{g.o}</div>
                {pitcher ? (
                  <>
                    <div className="w-[44px] text-right text-xs font-data text-text-primary">{typeof g.ip === "number" ? fmtIp(g.ip) : g.ip}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.h}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.r}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.bb}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-primary">{g.k}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.hr}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-dim">{g.bf}</div>
                    <div className="w-[44px] text-right text-xs font-data text-text-dim">{g.pc}</div>
                    <div className="w-[54px] text-right text-xs font-data font-medium"
                      style={{ color: typeof g.op === "number" ? gradeColor(g.op) : undefined }}
                      title={g.op != null ? `Outing+ ${g.op} · mean Pitching+ ${g.pp ?? "—"} · mean Whiff+ ${g.wp ?? "—"}` : "under 15 graded pitches — no Outing+"}>
                      {g.op ?? "—"}
                    </div>
                    <div className="w-[54px] text-right text-xs font-data text-text-secondary">{g.wp ?? "—"}</div>
                  </>
                ) : (
                  <>
                    <div className="w-[36px] text-right text-xs font-data text-text-primary">{g.pa}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.h}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-primary">{g.hr}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.bb}</div>
                    <div className="w-[36px] text-right text-xs font-data text-text-secondary">{g.k}</div>
                    <div className="w-[52px] text-right text-xs font-data text-text-secondary">{g.ev ?? "—"}</div>
                    <div className="w-[44px] text-right text-xs font-data text-text-dim">{g.hh}</div>
                  </>
                )}
              </div>
              {open && (
                <div className="border-b border-white/[0.04] bg-black/20">
                  {paLog === null ? (
                    <p className="px-4 py-2.5 text-[11px] text-text-dim">
                      {failed ? "Pitch sequences unavailable for this season." : "Loading pitch sequences…"}
                    </p>
                  ) : openPas ? (
                    <PaTable pas={openPas} />
                  ) : (
                    <p className="px-4 py-2.5 text-[11px] text-text-dim">No pitch sequences for this game.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div></div>
    </div>
  );
}
