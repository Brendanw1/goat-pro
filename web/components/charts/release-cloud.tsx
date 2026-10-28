"use client";

/**
 * Release point: where the ball left his hand, one dot per pitch — the college
 * chart's reading on Statcast release positions. Movement says what the pitch
 * does in the air, location says where it finished, this says where it
 * started: a tight cluster is a pitcher repeating his slot; a drifting cloud
 * is an arm that is dropping, and nothing else on the page shows that.
 *
 * Same cloud-and-ellipse grammar as the movement profile, deliberately — the
 * two are read side by side and a second visual grammar for the same idea
 * would make the reader learn it twice.
 */

import { useMemo, useState } from "react";

const PAD = 30;

function frameOf(values: number[], sd: number, fallback: [number, number]): [number, number] {
  if (!values.length) return fallback;
  const lo = Math.min(...values) - 1.5 * sd;
  const hi = Math.max(...values) + 1.5 * sd;
  return hi - lo < 0.5 ? [lo - 0.25, hi + 0.25] : [lo, hi];
}

export function ReleaseCloud({ release, colorOf, height = 320 }: {
  release: { points: [string, number, number][]; types: Record<string, { n: number; rh: number; rs: number; sdh: number; sds: number }> } | null;
  colorOf: (t: string) => string;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const view = useMemo(() => {
    if (!release?.points?.length) return null;
    const xs = release.points.map((p) => p[2]);
    const ys = release.points.map((p) => p[1]);
    const sdAll = Math.max(0.15, Math.max(
      release.types ? Math.max(...Object.values(release.types).map((t) => Math.max(t.sdh, t.sds))) : 0.2,
    ));
    const [x0, x1] = frameOf(xs, sdAll, [-2.5, 2.5]);
    const [y0, y1] = frameOf(ys, sdAll, [4, 7]);
    return { x0, x1, y0, y1 };
  }, [release]);

  if (!release?.points?.length || !view) {
    return <p className="text-xs text-text-dim py-6">No tracked release positions for this season.</p>;
  }

  const W = 640;
  const sx = (v: number) => PAD + ((v - view.x0) / (view.x1 - view.x0)) * (W - 2 * PAD);
  const sy = (v: number) => height - PAD - ((v - view.y0) / (view.y1 - view.y0)) * (height - 2 * PAD);

  const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
    `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto animate-fade-up" role="img"
        aria-label="Release position by pitch type">
        {[0.25, 0.5, 0.75].map((fr) => (
          <line key={fr} x1={PAD} y1={PAD + fr * (height - 2 * PAD)} x2={W - PAD} y2={PAD + fr * (height - 2 * PAD)}
            stroke="currentColor" className="text-border-subtle" strokeOpacity={0.25} />
        ))}
        <line x1={PAD} y1={height - PAD} x2={W - PAD} y2={height - PAD} stroke="currentColor" className="text-border-subtle" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={height - PAD} stroke="currentColor" className="text-border-subtle" />

        {Object.entries(release.types ?? []).map(([t, v]) => {
          const dim = active && active !== t;
          // 1σ and 2σ spread ellipses — the "is he repeating it" read.
          return (
            <g key={t} opacity={dim ? 0.15 : 1}>
              <path d={ellipse(sx(v.rs), sy(v.rh), Math.max(3, (v.sds * 2 * (W - 2 * PAD)) / (view.x1 - view.x0)),
                Math.max(3, (v.sdh * 2 * (height - 2 * PAD)) / (view.y1 - view.y0)))}
                fill="none" stroke={colorOf(t)} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.55} />
              <path d={ellipse(sx(v.rs), sy(v.rh), Math.max(2, (v.sds * (W - 2 * PAD)) / (view.x1 - view.x0)),
                Math.max(2, (v.sdh * (height - 2 * PAD)) / (view.y1 - view.y0)))}
                fill="none" stroke={colorOf(t)} strokeWidth={1.25} strokeOpacity={0.8} />
            </g>
          );
        })}
        {release.points.map((p, i) => {
          const dim = active && active !== p[0];
          return (
            <circle key={i} cx={sx(p[2])} cy={sy(p[1])} r={2.2} fill={colorOf(p[0])} fillOpacity={dim ? 0.08 : 0.4}>
              <title>{`${p[0]} · ${p[1]} ft high · ${p[2]} ft side`}</title>
            </circle>
          );
        })}
        {Object.entries(release.types ?? []).map(([t, v]) => (
          <g key={`l-${t}`} opacity={active && active !== t ? 0.2 : 1}
            onMouseEnter={() => setActive(t)} onMouseLeave={() => setActive(null)} style={{ cursor: "default" }}>
            <circle cx={sx(v.rs)} cy={sy(v.rh)} r={9} fill="transparent" />
            <text x={sx(v.rs) + 10} y={sy(v.rh) + 3} fontSize="10" className="font-data" fill={colorOf(t)}>{t}</text>
          </g>
        ))}
        <text x={PAD} y={height - 6} className="fill-text-dim" fontSize="9" letterSpacing="0.08em">RELEASE SIDE, FT (CATCHER&apos;S VIEW)</text>
        <text x={12} y={PAD - 10} className="fill-text-dim" fontSize="9" letterSpacing="0.08em" transform={`rotate(-90 12 ${PAD - 10})`} textAnchor="end">HEIGHT, FT</text>
      </svg>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5] max-w-[84ch]">
        Dashed ring = 2σ, solid = 1σ of that type&apos;s release. Hover a label to isolate a type. A type whose
        ellipses overlap its siblings comes from the same slot; one that sits apart is a different arm angle.
      </p>
    </div>
  );
}
