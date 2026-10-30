"use client";

import { useMemo, useState } from "react";
import type { HoopsShot } from "@/lib/data-hoops";

/**
 * Half-court shot chart from the mart's x/y coordinates (feet; x 0-50 across,
 * y 0 baseline → 47 midcourt, already normalized to the attacking half by the
 * bake). Descriptive: dots are raw coordinates, nothing modeled. Amber fill =
 * made, hollow = missed; size grows with point value.
 */

const RIM = { x: 25, y: 5.25 };

function Court() {
  return (
    <g stroke="rgba(148,163,184,0.35)" fill="none" strokeWidth={0.35}>
      <rect x={0} y={-5} width={50} height={52} stroke="none" fill="rgba(15,23,42,0.35)" />
      <line x1={0} y1={0} x2={50} y2={0} />                                  {/* baseline */}
      <line x1={0} y1={47} x2={50} y2={47} />                                {/* half court */}
      <rect x={19} y={0} width={12} height={19} />                           {/* paint */}
      <circle cx={25} cy={19} r={6} />                                       {/* FT circle */}
      <path d={arcPath()} />                                                 {/* 3pt arc */}
      <line x1={3} y1={0} x2={3} y2={14} />
      <line x1={47} y1={0} x2={47} y2={14} />
      <circle cx={RIM.x} cy={RIM.y} r={0.75} strokeWidth={0.4} />
      <line x1={22} y1={4} x2={28} y2={4} strokeWidth={0.4} />               {/* backboard */}
      <path d={`M ${RIM.x - 4} ${RIM.y} a 4 4 0 0 0 8 0`} strokeDasharray="0.6 0.6" /> {/* restricted */}
    </g>
  );
}

/** 3pt arc: radius 23.75 about the rim, meeting the corner lines at y=14. */
function arcPath() {
  const r = 23.75;
  const dy = 14 - RIM.y;
  const dx = Math.sqrt(r * r - dy * dy);
  const x1 = RIM.x - dx, x2 = RIM.x + dx;
  return `M ${x1} 14 A ${r} ${r} 0 0 0 ${x2} 14`;
}

export function ShotChart({ shots, home, away }: {
  shots: HoopsShot[]; home: string | null; away: string | null;
}) {
  const [side, setSide] = useState<"all" | "home" | "away">("all");
  const [result, setResult] = useState<"all" | "made" | "missed">("all");
  const [hover, setHover] = useState<HoopsShot | null>(null);

  type ChartShot = HoopsShot & { x: number; y: number };
  const shown = useMemo<ChartShot[]>(() => shots.flatMap((s) => {
    if (s.x == null || s.y == null) return [];
    if (side !== "all" && s.a !== (side === "home" ? home : away)) return [];
    if (result === "made" && !s.m) return [];
    if (result === "missed" && s.m) return [];
    return [{ ...s, x: s.x, y: s.y }];
  }), [shots, side, result, home, away]);

  const made = shown.filter((s) => s.m).length;
  const pts = shown.reduce((a, s) => a + s.v, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
        {(["all", "home", "away"] as const).map((v) => (
          <button key={v} onClick={() => setSide(v)}
            className={`rounded px-2 py-0.5 border ${side === v ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent hover:text-text-secondary"}`}>
            {v === "all" ? "Both" : v === "home" ? home : away}
          </button>
        ))}
        <span className="text-border-subtle">·</span>
        {(["all", "made", "missed"] as const).map((v) => (
          <button key={v} onClick={() => setResult(v)}
            className={`rounded px-2 py-0.5 border ${result === v ? "border-border-subtle bg-white/[0.06] text-text-primary" : "border-transparent hover:text-text-secondary"}`}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
        <span className="ml-auto tabular-nums">{made}/{shown.length} FG · {pts} pts</span>
      </div>
      <svg viewBox="-1 -6 52 54" className="w-full max-w-md mx-auto">
        <Court />
        {shown.map((s, i) => (
          <g key={i} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)}>
            {s.m ? (
              <circle cx={s.x} cy={s.y} r={0.55 + 0.25 * (s.v > 2 ? 1 : 0)}
                fill="rgba(245,158,11,0.85)" stroke="rgba(245,158,11,0.95)" strokeWidth={0.2} />
            ) : (
              <g stroke="rgba(148,163,184,0.7)" strokeWidth={0.22}>
                <line x1={s.x - 0.5} y1={s.y - 0.5} x2={s.x + 0.5} y2={s.y + 0.5} />
                <line x1={s.x - 0.5} y1={s.y + 0.5} x2={s.x + 0.5} y2={s.y - 0.5} />
              </g>
            )}
          </g>
        ))}
      </svg>
      <div className="h-4 text-[11px] text-text-dim text-center truncate">
        {hover
          ? `${hover.s ?? "?"} · ${hover.ty ?? "?"} · ${hover.m ? `made ${hover.v}` : "missed"} · Q${hover.p}`
          : "hover a shot for details"}
      </div>
    </div>
  );
}
