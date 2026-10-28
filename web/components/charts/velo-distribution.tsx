"use client";

/**
 * Where his arsenal sits on the radar gun — the college chart's renderer,
 * re-fed from the bake: `web_export.py` computes the usage-area-normalised
 * kernel curves (Silverman window with the 0.4-mph floor, CURVE_FLOOR 15 →
 * rug of ticks) so the payload is the drawing, not the pitches.
 *
 * One filled curve per pitch type, labelled on its own peak rather than in a
 * legend. Each curve's AREA is how often he throws it, not one — a show-me
 * pitch must not read as a primary.
 */

const WIDTH = 900;
const HEIGHT = 300;
const PAD_L = 34;
const PAD_R = 24;
const PAD_TOP = 30;
const PAD_BOTTOM = 34;

const PLOT_W = WIDTH - PAD_L - PAD_R;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function ticksFor([lo, hi]: [number, number]): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / 5) * 5; v <= hi; v += 5) out.push(v);
  return out;
}

/** Push labels apart so two peaks within a couple of mph do not collide. */
function placeLabels(labels: { key: string; x: number; y: number; text: string; color: string }[]): typeof labels {
  const MIN_GAP = 58;
  const placed: typeof labels = [];
  for (const label of labels) {
    let { x, y } = label;
    for (const other of placed) {
      if (Math.abs(other.x - x) < MIN_GAP && Math.abs(other.y - y) < 16) y = other.y - 16;
    }
    placed.push({ ...label, x, y: Math.max(y, 12) });
  }
  return placed;
}

export function VeloDistribution({ velo, colorOf }: {
  velo: { domain: [number, number]; total: number; series: any[] } | null;
  colorOf: (t: string) => string;
}) {
  if (!velo?.series?.length) {
    return <p className="text-xs text-text-dim">No tracked release speeds for this season.</p>;
  }
  const { domain, series } = velo;
  // 1.08 headroom for the label sitting on the tallest peak.
  const maxY = Math.max(...series.flatMap((s) => (s.points?.length ? s.points.map((p: any) => p[1]) : [0])));

  const sx = (v: number) => PAD_L + ((v - domain[0]) / (domain[1] - domain[0])) * PLOT_W;
  const sy = (v: number) => PAD_TOP + PLOT_H - (v / (maxY * 1.08 || 1)) * PLOT_H;

  const labels = placeLabels(
    series
      .filter((s) => s.points?.length)
      .map((s) => ({
        key: s.t,
        x: sx(s.peak_x),
        y: sy(s.peak_y) - 8,
        text: `${s.t} · ${s.mean.toFixed(1)}`,
        color: colorOf(s.t),
      })),
  );

  return (
    <>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto animate-fade-up" role="img"
        aria-label="Release speed distribution by pitch type">
        {ticksFor(domain).map((v) => (
          <g key={v}>
            <line x1={sx(v)} y1={PAD_TOP} x2={sx(v)} y2={PAD_TOP + PLOT_H} stroke="currentColor"
              className="text-border-subtle" strokeOpacity={0.5} />
            <text x={sx(v)} y={PAD_TOP + PLOT_H + 18} textAnchor="middle" className="fill-text-dim font-data" fontSize="10">
              {v}
            </text>
          </g>
        ))}
        <line x1={PAD_L} y1={PAD_TOP + PLOT_H} x2={PAD_L + PLOT_W} y2={PAD_TOP + PLOT_H}
          stroke="currentColor" className="text-border-subtle" />

        {series.map((s) =>
          s.points?.length ? (
            <g key={s.t}>
              <path
                d={`M ${sx(s.points[0][0])} ${sy(0)} ` + s.points.map((p: any) => `L ${sx(p[0])} ${sy(p[1])}`).join(" ") +
                  ` L ${sx(s.points[s.points.length - 1][0])} ${sy(0)} Z`}
                fill={colorOf(s.t)} fillOpacity={0.22} />
              <path d={`M ${s.points.map((p: any) => `${sx(p[0])} ${sy(p[1])}`).join(" L ")}`}
                fill="none" stroke={colorOf(s.t)} strokeWidth={1.75} strokeOpacity={0.9} />
            </g>
          ) : (
            // Below the curve floor a type is its own pitches — a rug of ticks,
            // not a density estimate from nine of them.
            <g key={s.t}>
              {(s.ticks ?? []).map((v: number, i: number) => (
                <line key={i} x1={sx(v)} y1={PAD_TOP + PLOT_H} x2={sx(v)} y2={PAD_TOP + PLOT_H - 9}
                  stroke={colorOf(s.t)} strokeWidth={1.5} strokeOpacity={0.75} />
              ))}
            </g>
          ),
        )}

        {labels.map((l) => (
          <text key={l.key} x={l.x} y={l.y} textAnchor="middle" fill={l.color} fontSize="11" className="font-data">
            {l.text}
          </text>
        ))}

        <text x={PAD_L} y={HEIGHT - 4} className="fill-text-dim" fontSize="9" letterSpacing="0.08em">
          RELEASE SPEED, MPH
        </text>
      </svg>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5] max-w-[84ch]">
        {`Each curve's area is how often he throws it, not one — a pitch thrown 8% of the time is drawn 8% as large. ` +
          `${velo.total} counted pitches.` +
          (series.some((s) => !s.points?.length)
            ? ` ${series.filter((s) => !s.points?.length).map((s) => s.t).join(", ")} draw` +
              `${series.filter((s) => !s.points?.length).length === 1 ? "s" : ""} as individual ticks rather than a curve.`
            : "")}
      </p>
    </>
  );
}
