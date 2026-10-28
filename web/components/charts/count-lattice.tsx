"use client";

/**
 * The count lattice: what he throws, and where plate appearances go — the
 * college chart, re-fed from the bake (`counts` in visuals/{id}-{season}).
 *
 * Twelve nodes, one per legal count, positioned on the balls×strikes grid.
 * Node AREA is its pitch count (√-scaled radius); the donut is his pitch mix
 * there. Edges are the calls: the PAs that took (b,s) → (b+1,s) are exactly
 * the balls thrown at (b,s) — transitions read off the call, not a rebuilt
 * sequence. A two-strike foul is a self-loop the lattice does not draw, which
 * is right: the count did not change. Terminals (K / BB / HBP / ball in play)
 * sit under the node they ended.
 */

import { useMemo, useState } from "react";

/** Pitches a node needs before it shows a mix — a donut is read as shape, and five pitches still answer "what does he go to here". */
const NODE_FLOOR = 5;

const COL = 88;
const ROW = 96;
const PAD_X = 74;
const PAD_TOP = 34;
const PAD_BOTTOM = 52;
const X_MIN = -2;
const X_MAX = 3;
const Y_MAX = 5;

const WIDTH = (X_MAX - X_MIN) * COL + PAD_X * 2;
const HEIGHT = Y_MAX * ROW + PAD_TOP + PAD_BOTTOM;

const R_MIN = 7;
const R_MAX = 26;

const LATTICE: { key: string; x: number; y: number }[] = (() => {
  const out: { key: string; x: number; y: number }[] = [];
  for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) out.push({ key: `${b}-${s}`, x: b - 2, y: 5 - s });
  return out;
})();

const px = (node: { x: number }) => PAD_X + (node.x - X_MIN) * COL;
const py = (node: { y: number }) => PAD_TOP + node.y * ROW;

function radius(n: number, maxN: number): number {
  if (n <= 0) return R_MIN * 0.7;
  if (maxN <= 0) return R_MIN;
  return R_MIN + (R_MAX - R_MIN) * Math.sqrt(n / maxN);
}

/** One wedge of a donut as an SVG path, angles clockwise from twelve. */
function wedge(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number): string {
  const a0 = from * 2 * Math.PI - Math.PI / 2;
  const a1 = to * 2 * Math.PI - Math.PI / 2;
  const large = to - from > 0.5 ? 1 : 0;
  const ox = cx + rOuter * Math.cos(a0), oy = cy + rOuter * Math.sin(a0);
  const ox2 = cx + rOuter * Math.cos(a1), oy2 = cy + rOuter * Math.sin(a1);
  const ix = cx + rInner * Math.cos(a1), iy = cy + rInner * Math.sin(a1);
  const ix2 = cx + rInner * Math.cos(a0), iy2 = cy + rInner * Math.sin(a0);
  return `M ${ox} ${oy} A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2} L ${ix} ${iy} A ${rInner} ${rInner} 0 ${large} 0 ${ix2} ${iy2} Z`;
}

export function CountLattice({ counts, colorOf }: {
  counts: Record<string, { n: number; m: [string, number][]; b: number; s: number; k: number; bb: number; hbp: number }> | null;
  colorOf: (t: string) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const view = useMemo(() => {
    const nodes = LATTICE.map((l) => ({ ...l, data: counts?.[l.key] ?? null }));
    const maxN = Math.max(1, ...nodes.map((n) => n.data?.n ?? 0));
    return { nodes, maxN };
  }, [counts]);

  if (!counts || !Object.keys(counts).length) {
    return <p className="text-xs text-text-dim py-6">No counted pitches for this season.</p>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto animate-fade-up" role="img"
        aria-label="Pitch mix and count flow by count">
        {/* edges first, under the nodes */}
        {view.nodes.flatMap((node) => {
          const d = node.data;
          if (!d || node.y >= Y_MAX) return [];
          const out: any[] = [];
          const cx = px(node), cy = py(node);
          const r = radius(d.n, view.maxN);
          // (b,s) -> (b+1,s): the balls. Drawn only while balls < 3.
          const b = Number(node.key.split("-")[0]), s = Number(node.key.split("-")[1]);
          if (d.b > 0 && b < 3) {
            const to = view.nodes.find((n) => n.key === `${b + 1}-${s}`)!;
            out.push(
              <g key={`${node.key}-b`}>
                <line x1={cx + r} y1={cy} x2={px(to) - radius(to.data?.n ?? 0, view.maxN) - 6} y2={cy}
                  stroke="currentColor" className="text-border-subtle" strokeWidth={Math.min(4, 1 + d.b / 150)}
                  markerEnd="url(#arrow)" opacity={0.7}>
                  <title>{`${node.key} → ${b + 1}-${s}: ${d.b} balls`}</title>
                </line>
                <text x={(cx + px(to)) / 2} y={cy - 6} textAnchor="middle" fontSize="8.5" className="fill-text-dim font-data">{d.b}</text>
              </g>,
            );
          }
          if (d.s > 0 && s < 2) {
            const to = view.nodes.find((n) => n.key === `${b}-${s + 1}`)!;
            out.push(
              <g key={`${node.key}-s`}>
                <line x1={cx} y1={cy + r} x2={cx} y2={py(to) - radius(to.data?.n ?? 0, view.maxN) - 6}
                  stroke="currentColor" className="text-border-subtle" strokeWidth={Math.min(4, 1 + d.s / 150)}
                  markerEnd="url(#arrow)" opacity={0.7}>
                  <title>{`${node.key} → ${b}-${s + 1}: ${d.s} strikes`}</title>
                </line>
                <text x={cx + 10} y={(cy + py(to)) / 2} fontSize="8.5" className="fill-text-dim font-data">{d.s}</text>
              </g>,
            );
          }
          return out;
        })}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-border-subtle" />
          </marker>
        </defs>

        {view.nodes.map((node) => {
          const d = node.data;
          const cx = px(node), cy = py(node);
          const r = radius(d?.n ?? 0, view.maxN);
          const total = d?.m?.reduce((a, w) => a + w[1], 0) ?? 0;
          const thin = (d?.n ?? 0) < NODE_FLOOR;
          return (
            <g key={node.key} onMouseEnter={() => setHover(node.key)} onMouseLeave={() => setHover(null)}>
              <circle cx={cx} cy={cy} r={Math.max(r, R_MIN * 0.7)} fill="rgba(255,255,255,0.02)"
                stroke="currentColor" className="text-border-subtle" strokeOpacity={0.5} />
              {d && total > 0 && !thin && d.m.map(([t, nn], i) => {
                const from = d.m.slice(0, i).reduce((a, w) => a + w[1], 0) / total;
                const to = from + nn / total;
                return (
                  <path key={t} d={wedge(cx, cy, r, r * 0.45, from, to)} fill={colorOf(t)} fillOpacity={0.85}>
                    <title>{`${node.key}: ${t} ${nn} of ${d.n}`}</title>
                  </path>
                );
              })}
              <text x={cx} y={cy + r + 13} textAnchor="middle" fontSize="10" className="font-data fill-text-secondary">{node.key}</text>
              {d && (
                <text x={cx} y={cy - r - 5} textAnchor="middle" fontSize="9" className="fill-text-dim font-data">{d.n}</text>
              )}
              {d && (d.k > 0 || d.bb > 0 || d.hbp > 0) && (
                <text x={cx} y={cy + r + 26} textAnchor="middle" fontSize="8.5" className="fill-text-dim font-data">
                  {[d.k ? `${d.k} K` : null, d.bb ? `${d.bb} BB` : null, d.hbp ? `${d.hbp} HBP` : null].filter(Boolean).join(" · ")}
                </text>
              )}
            </g>
          );
        })}
        {hover && counts[hover] && (
          <text x={PAD_X} y={HEIGHT - 8} fontSize="10" className="fill-text-secondary font-data">
            {`${hover}: ${counts[hover].n} pitches — ` +
              counts[hover].m.slice(0, 4).map(([t, nn]) => `${t} ${Math.round((100 * nn) / counts[hover]!.n)}%`).join(" · ")}
          </text>
        )}
      </svg>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5] max-w-[84ch]">
        Node area is pitch count; the donut is what he throws there. Arrows are the calls (ball right, strike down),
        labelled with how many; fouls are the self-loop not drawn. A ring thinner than {NODE_FLOOR} pitches is a lean.
      </p>
    </div>
  );
}
