"use client";

/**
 * The season arc (depth wave): every game of the season left to right, one
 * bar each, so the shape of the year is visible before the numbers are — the
 * hot month, the dead stretch, the gradual climb. Bars are the game's K
 * (pitcher) or hits (hitter); a gold ring marks home runs for a hitter and a
 * red tick the runs charged to a pitcher. Hover names the game; the game-log
 * tab below carries the table and the pitch sequences.
 */

import { useMemo } from "react";

export function SeasonArc({ data }: { data: any | null }) {
  const games = useMemo(() => {
    const rows = [...(data?.games ?? [])].sort((a: any, b: any) => String(a.d).localeCompare(String(b.d)));
    return rows;
  }, [data]);
  if (games.length < 3) return null;
  const pitcher = data.side === "P";
  const W = 900, H = 64, PAD = 2;
  const bw = Math.max(2, (W - 2 * PAD) / games.length - 1.5);
  const key = pitcher ? "k" : "h";
  const max = Math.max(1, ...games.map((g: any) => g[key] ?? 0));
  const barH = (g: any) => ((g[key] ?? 0) / max) * (H - 18);

  return (
    <div className="glass-panel px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
          The season, game by game
        </h2>
        <span className="text-[10px] text-text-dim">
          {pitcher ? "bar = strikeouts · tick = runs charged" : "bar = hits · ring = home run"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Season arc: ${pitcher ? "strikeouts" : "hits"} by game`}>
        {games.map((g: any, i: number) => {
          const x = PAD + i * ((W - 2 * PAD) / games.length);
          const h = barH(g);
          return (
            <g key={i}>
              <rect x={x} y={H - 12 - h} width={bw} height={Math.max(h, 1)}
                fill="rgba(232,119,34,0.55)" rx={1}>
                <title>{`${g.d} vs ${g.o} — ${pitcher
                  ? `${g.ip} IP, ${g.k} K, ${g.r} R`
                  : `${g.pa} PA, ${g.h} for ${g.pa}${g.hr ? `, ${g.hr} HR` : ""}`}`}</title>
              </rect>
              {pitcher && g.r > 0 ? (
                <line x1={x + bw / 2} y1={H - 10} x2={x + bw / 2} y2={H - 10 - Math.min(6, g.r * 2)}
                  stroke="#e0654f" strokeWidth={bw * 0.6} strokeOpacity={0.8} />
              ) : null}
              {!pitcher && g.hr > 0 ? (
                <circle cx={x + bw / 2} cy={H - 12 - h - 4} r={2.2}
                  fill="none" stroke="var(--usf-gold, #e8b54a)" strokeWidth={1} />
              ) : null}
            </g>
          );
        })}
        <line x1={PAD} y1={H - 10.5} x2={W - PAD} y2={H - 10.5} stroke="currentColor" className="text-border-subtle" />
      </svg>
    </div>
  );
}
