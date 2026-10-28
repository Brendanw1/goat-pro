"use client";

/**
 * Faceted pitch-location density surfaces — the college pitch-surface plot's
 * density layer, re-fed from the bake. The college computed the kernel
 * client-side from per-pitch events; here `web_export.py` fits the KDE per
 * type and ships a max-normalised grid, so this component only paints cells.
 *
 * The ramp is the college LOCATION ramp (multi-hue since their 2026-10-23
 * change): a single hue makes "he goes here a lot" and "this is THE spot" the
 * same shade, so pale yellow → orange → magenta → violet → indigo. Panels
 * share a cross-panel cursor: hovering a cell rings that plate location in
 * every panel, which is how a progression reads as one picture. Each panel
 * names its busiest cell (the hero read) and every cell is reachable without
 * colour via the hover value.
 */

import { useState } from "react";

/** The college LOCATION ramp anchors (normalised 0–1). */
const RAMP: [number, [number, number, number]][] = [
  [0.0, [250, 247, 237]],   // pale yellow (paper)
  [0.25, [232, 118, 26]],   // orange
  [0.5, [214, 61, 154]],    // magenta
  [0.75, [130, 80, 200]],   // violet
  [1.0, [64, 60, 160]],     // indigo
];

function rampColor(v: number): string {
  const t = Math.max(0, Math.min(1, v));
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [p0, c0] = RAMP[i - 1], [p1, c1] = RAMP[i];
      const u = (t - p0) / (p1 - p0);
      const mix = c0.map((c, k) => Math.round(c + (c1[k] - c) * u));
      // Low density fades to transparent so the pale end never floods a dark panel.
      return `rgba(${mix[0]},${mix[1]},${mix[2]},${Math.min(1, t / 0.2).toFixed(2)})`;
    }
  }
  return "rgb(64,60,160)";
}

const PW = 220;
const PH = 240;

/**
 * Where a grid cell sits in spoken feet: height band + side of the plate.
 * A batter's frame mirrors plate_x by the scouting-grid rule (-1 for a RHH,
 * +1 for a LHH) so inside/away read hand-free; a pitcher's frame stays in the
 * catcher's view and names first/third base.
 */
function spoken(fx: number, fz: number, mir: number): string {
  const x = mir === 0 ? fx : fx * mir;
  const side = mir !== 0
    ? (x > 0.28 ? "inside" : x < -0.28 ? "away" : "middle")
    : (x > 0.28 ? "1B side" : x < -0.28 ? "3B side" : "middle");
  const height = fz > 3.6 ? "high" : fz < 1.9 ? "low" : "mid";
  return `${height} ${side}`;
}

export function LocationSurfaces({ loc, zone, stand, colorOf }: {
  loc: { x: [number, number]; z: [number, number]; n: number; types: Record<string, any> } | null;
  zone: [number, number] | null;
  /** Batter side: mirror inside/away so "inside" is his inside (scouting-grid convention). */
  stand?: string | null;
  colorOf?: (t: string) => string;
}) {
  const [cursor, setCursor] = useState<{ i: number; j: number } | null>(null);
  const types = Object.entries(loc?.types ?? {}).filter(([, v]) => v?.cells);
  if (!types.length) {
    return <p className="text-xs text-text-dim py-6">Not enough tracked locations for a surface this season.</p>;
  }
  const x0 = loc!.x[0], x1 = loc!.x[1], z0 = loc!.z[0], z1 = loc!.z[1];
  const n = loc!.n;
  // A batter's frame reads from his side of the plate: the scouting-grid mirror.
  const mir = stand === "R" ? -1 : stand === "L" ? 1 : 0;

  const feetOf = (i: number, j: number) => ({
    x: x0 + ((i + 0.5) / n) * (x1 - x0),
    z: z0 + ((j + 0.5) / n) * (z1 - z0),
  });
  const zx = (ft: number) => Math.round(((ft - x0) / (x1 - x0)) * n);
  const zy = (ft: number) => Math.round(((ft - z0) / (z1 - z0)) * n);

  return (
    <div>
      <div className="flex flex-wrap gap-4">
        {types.map(([t, v]) => {
          const cells: number[][] = v.cells;
          let hero = null as { i: number; j: number; v: number } | null;
          for (let j = 0; j < cells.length; j++) {
            for (let i = 0; i < cells[j].length; i++) {
              if (!hero || cells[j][i] > hero.v) hero = { i, j, v: cells[j][i] };
            }
          }
          const heroF = hero ? feetOf(hero.i, hero.j) : null;
          return (
            <div key={t} className="rounded-lg border border-border-subtle p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: colorOf ? colorOf(t) : undefined }}>{t}</span>
                <span className="text-[9px] text-text-dim font-data">n={v.n}</span>
              </div>
              <svg viewBox={`0 0 ${PW} ${PH}`} className="w-[200px] h-auto" role="img" aria-label={`${t} location density`}
                onMouseLeave={() => setCursor(null)}>
                {cells.map((row, j) =>
                  row.map((val, i) => (
                    <rect key={`${i}-${j}`} x={(i / n) * PW} y={PH - ((j + 1) / n) * PH}
                      width={PW / n} height={PH / n} shapeRendering="crispEdges"
                      fill={val > 0.003 ? rampColor(val) : "rgba(255,255,255,0.015)"}
                      stroke={cursor && cursor.i === i && cursor.j === j ? "#fff" : "none"} strokeWidth={1}
                      onMouseEnter={() => setCursor({ i, j })}>
                      <title>{`${t}: ${spoken(feetOf(i, j).x, feetOf(i, j).z, mir)} — ${((val * (v.max ?? 1)) * 100).toFixed(1)}% of pitches per cell${hero && hero.i === i && hero.j === j ? " · busiest" : ""}`}</title>
                    </rect>
                  )),
                )}
                {zone && (
                  <rect x={(zx(-0.83) / n) * PW} y={PH - (zy(zone[1]) / n) * PH}
                    width={((zx(0.83) - zx(-0.83)) / n) * PW} height={((zy(zone[1]) - zy(zone[0])) / n) * PH}
                    fill="none" stroke="#fff" strokeOpacity={0.55} strokeDasharray="4 3" strokeWidth={1} />
                )}
                {cursor && (
                  <g>
                    <line x1={(cursor.i / n) * PW} y1={0} x2={(cursor.i / n) * PW} y2={PH} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.75} />
                    <line x1={0} y1={PH - ((cursor.j + 1) / n) * PH} x2={PW} y2={PH - ((cursor.j + 1) / n) * PH} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.75} />
                  </g>
                )}
              </svg>
              <p className="text-[9px] text-text-dim mt-1 font-data">
                {hero && heroF
                  ? `busiest: ${((hero.v * (v.max ?? 1)) * 100).toFixed(1)}% per cell · ${spoken(heroF.x, heroF.z, mir)}`
                  : "points only"}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5] max-w-[84ch]">
        Density per cell, each panel scaled to its own busiest cell — the hero read under it names that spot.
        Hovering a cell rings the same spot in every panel. Dashed rectangle = the league&apos;s average rulebook zone.
        {mir ? " Inside/away mirror his hand." : " Side names the catcher's view (first/third base)."}
      </p>
    </div>
  );
}
