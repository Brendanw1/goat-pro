"use client";

/**
 * The count lattice: what he throws, and where his plate appearances go. Ported from the college site
 * (BaseballGOAT web/components/charts/count-lattice.tsx); the arithmetic is in lib/count-lattice.ts, fed from
 * the bake, with the college's Overall / vs RHH / vs LHH split. This file is geometry: where a node sits, how
 * big it is, and what colour its wedges are.
 */

import { useMemo, useState } from "react";
import { bakedSides, countFlow, NODE_FLOOR, type CountFlow } from "@/lib/count-lattice";

/** Lattice-space to pixels. `x` spans −2…3 and `y` spans 0…5. */
const COL = 88;
const ROW = 78;
const PAD_X = 74;
const PAD_TOP = 40;
const PAD_BOTTOM = 46;
const X_MIN = -2;
const X_MAX = 3;
const Y_MAX = 5;

const WIDTH = (X_MAX - X_MIN) * COL + PAD_X * 2;
const HEIGHT = Y_MAX * ROW + PAD_TOP + PAD_BOTTOM;

/**
 * Node radius runs with √n, so the *area* of a node is its pitch count.
 *
 * Radius-proportional circles overstate a big node by the square of the ratio,
 * which on a lattice where 0-0 carries ten times 3-0 is the difference between
 * "more" and "a hundred times more".
 */
const R_MIN = 7;
const R_MAX = 30;

function radius(n: number, maxN: number): number {
  if (n <= 0) return R_MIN * 0.7;
  if (maxN <= 0) return R_MIN;
  return R_MIN + (R_MAX - R_MIN) * Math.sqrt(n / maxN);
}

const px = (node: { x: number; y: number }) => ({
  cx: PAD_X + (node.x - X_MIN) * COL,
  cy: PAD_TOP + node.y * ROW,
});

/** One wedge of a donut, as an SVG path. Angles run clockwise from twelve. */
function wedge(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number): string {
  // A full circle cannot be drawn as one arc — start and end coincide and the
  // renderer draws nothing. A single-pitch node is exactly that case.
  if (to - from >= Math.PI * 2 - 1e-9) {
    return (
      `M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 1 1 ${cx - 0.001} ${cy - rOuter} Z ` +
      `M ${cx} ${cy - rInner} A ${rInner} ${rInner} 0 1 0 ${cx - 0.001} ${cy - rInner} Z`
    );
  }
  const p = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x1, y1] = p(rOuter, from);
  const [x2, y2] = p(rOuter, to);
  const [x3, y3] = p(rInner, to);
  const [x4, y4] = p(rInner, from);
  const large = to - from > Math.PI ? 1 : 0;
  return (
    `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} ` +
    `L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`
  );
}

export function CountLatticeChart({ flow }: { flow: CountFlow }) {
  const [hover, setHover] = useState<string | null>(null);

  /** Where an edge's label sits: just past the midpoint, clear of both nodes. */
  const labelAt = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => ({
    x: a.cx + (b.cx - a.cx) * 0.52,
    y: a.cy + (b.cy - a.cy) * 0.52,
  });

  const maxN = Math.max(...flow.nodes.map((n) => n.n), 1);
  const maxEdge = Math.max(...flow.edges.map((e) => e.n), 1);
  const byCount = new Map(flow.nodes.map((n) => [n.count, n]));
  const hovered = hover === null ? null : byCount.get(hover) ?? null;

  /** The arsenal, for the legend — a donut alone does not say which colour is which. */
  const arsenal = useMemo(() => {
    const totals = new Map<string, { label: string; color: string; n: number }>();
    for (const node of flow.nodes) {
      for (const slice of node.mix) {
        const entry = totals.get(slice.pitchType);
        if (entry === undefined) {
          totals.set(slice.pitchType, { label: slice.label, color: slice.color, n: slice.n });
        } else entry.n += slice.n;
      }
    }
    return [...totals.values()].sort((a, b) => b.n - a.n);
  }, [flow]);

  if (flow.pitches === 0) {
    return (
      <p className="text-xs text-text-dim">
        He has thrown nothing the tracking placed in a count, so there is no
        lattice to draw.
      </p>
    );
  }

  return (
    <div className="flex items-start gap-5 flex-wrap">
      <div className="flex-1 min-w-0 sm:min-w-[340px] max-w-[620px]">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto animate-fade-up"
          role="img"
          aria-label="Pitch mix by count, laid out as the count lattice"
        >
          {/* Edges first, so a node always sits on top of the lines into it. */}
          <g>
            {flow.edges.map((edge) => {
              const from = byCount.get(edge.from)!;
              const to = byCount.get(edge.to)!;
              const a = px(from);
              const b = px(to);
              const share = edge.n / maxEdge;
              const dim =
                hovered !== null && edge.from !== hovered.count && edge.to !== hovered.count;
              // The share *of this count*, which is what a branch percentage
              // means: of the plate appearances that reached 1-1, how many left
              // it on a strike. Dividing by the widest edge on the lattice
              // instead would make every number relative to 0-0 and mean
              // nothing.
              const outOf = from.reaching;
              const pct = outOf > 0 ? (100 * edge.n) / outOf : null;
              const at = labelAt(a, b);
              return (
                <g key={`${edge.from}>${edge.to}`} opacity={dim ? 0.25 : 1}>
                  <line
                    x1={a.cx}
                    y1={a.cy}
                    x2={b.cx}
                    y2={b.cy}
                    stroke={edge.kind === "strike" ? "#FDBB30" : "#7AA7FF"}
                    strokeWidth={1 + 7 * share}
                    // Thin paths read as thin.
                    strokeOpacity={edge.n < NODE_FLOOR ? 0.15 : 0.22 + 0.45 * share}
                    strokeLinecap="round"
                   role="img" data-tip="" aria-label={`${edge.from} → ${edge.to} on a ${edge.kind}: ${edge.n} plate appearances`}>
                  </line>
                  {pct !== null && edge.n > 0 && (
                    <text
                      x={at.x}
                      y={at.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="font-data pointer-events-none"
                      fontSize="9"
                      fill={edge.kind === "strike" ? "#FDBB30" : "#7AA7FF"}
                      fillOpacity={0.92}
                      // A halo, so a number sitting on its own line stays
                      // readable without a box behind it.
                      stroke="#0A0E0D"
                      strokeWidth="2.5"
                      paintOrder="stroke"
                    >
                      {pct.toFixed(0)}%
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          <g>
            {flow.nodes.map((node) => {
              const { cx, cy } = px(node);
              const r = radius(node.n, maxN);
              const dim = hovered !== null && hovered.count !== node.count;
              let angle = 0;
              return (
                <g
                  key={node.count}
                  role="img" data-tip="" aria-label={`${node.count}: ${node.n} pitches, ${node.reaching} plate appearances`}
                  opacity={dim ? 0.3 : 1}
                  onMouseEnter={() => setHover(node.count)}
                  onMouseLeave={() => setHover(null)}
                  className="transition-opacity duration-150 cursor-default"
                >
                  {node.hasMix ? (
                    node.mix.map((slice) => {
                      const from = angle;
                      const to = angle + (slice.pct / 100) * Math.PI * 2;
                      angle = to;
                      return (
                        <path
                          key={slice.pitchType}
                          d={wedge(cx, cy, r, r * 0.4, from, to)}
                          fill={slice.color}
                          fillOpacity={0.92}
                        />
                      );
                    })
                  ) : (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke="#8C9591"
                      strokeOpacity={0.45}
                      strokeDasharray="3 3"
                    />
                  )}
                  {/* A hit target that does not change with the node's size, so a
                      3-0 nobody reaches is still hoverable. */}
                  <circle cx={cx} cy={cy} r={Math.max(r, 18)} fill="transparent" />
                  <text
                    x={cx}
                    y={cy + r + 13}
                    textAnchor="middle"
                    className="fill-text-secondary font-data"
                    fontSize="10.5"
                  >
                    {node.count}
                  </text>
                  <text
                    x={cx}
                    y={cy + r + 24}
                    textAnchor="middle"
                    className="fill-text-dim font-data"
                    fontSize="9"
                  >
                    {node.n}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="w-[220px] shrink-0">
        {hovered ? (
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
              {hovered.count}
            </h2>
            <div className="text-[11px] text-text-secondary mt-0.5 mb-2 font-data">
              {hovered.n} pitches · {hovered.reaching} PA
              {hovered.reaching > 0 && flow.plateAppearances > 0
                ? ` · ${((100 * hovered.reaching) / flow.plateAppearances).toFixed(0)}% of PAs reach here`
                : ""}
            </div>
            {hovered.hasMix ? (
              hovered.mix.map((slice) => (
                <div key={slice.pitchType} className="flex items-center gap-2 py-0.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: slice.color }}
                  />
                  <span className="text-[11px] text-text-secondary flex-1 truncate">
                    {slice.label}
                  </span>
                  <span className="text-[11px] font-data tabular-nums text-text-secondary">
                    {slice.pct.toFixed(0)}%
                  </span>
                  <span className="text-[10px] font-data tabular-nums text-text-dim w-[26px] text-right">
                    {slice.n}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[11px] text-text-dim leading-[1.5]">
                Fewer than {NODE_FLOOR} pitches here, so the mix is not drawn. An
                empty node is a scouting fact — it says he does not get to this
                count.
              </p>
            )}
          </div>
        ) : (
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
              Arsenal
            </h2>
            {arsenal.map((p) => (
              <div key={p.label} className="flex items-center gap-2 py-0.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: p.color }}
                />
                <span className="text-[11px] text-text-secondary flex-1 truncate">{p.label}</span>
                <span className="text-[10px] font-data tabular-nums text-text-dim">{p.n}</span>
              </div>
            ))}
            <p className="text-[10px] text-text-dim mt-3 leading-[1.5]">
              Node area is pitches thrown; the ring is his mix there. Each branch
              is labelled with the share of the plate appearances at that count
              which took it —{" "}
              <span style={{ color: "#FDBB30" }}>gold on a strike</span>,{" "}
              <span style={{ color: "#7AA7FF" }}>blue on a ball</span>. The two
              rarely sum to 100: the rest ended there, in a strikeout, a walk or
              a ball in play. Hover a node for its breakdown.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const SIDES = [["all", "Overall"], ["R", "vs RHH"], ["L", "vs LHH"]] as const;

export function CountLattice({ counts }: { counts: unknown }) {
  const sides = useMemo(() => bakedSides(counts), [counts]);
  const [side, setSide] = useState<"all" | "R" | "L">("all");
  const flow = useMemo(() => countFlow(sides[side] ?? sides.all), [sides, side]);
  return (
    <div className="space-y-3">
      {(sides.R || sides.L) && (
        <div className="flex gap-1" role="group" aria-label="Batter side">
          {SIDES.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSide(k)} aria-pressed={side === k}
              disabled={!sides[k]}
              className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${side === k
                ? "filter-chip-active" : "border-border-subtle text-text-secondary hover:bg-white/[0.03]"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      <CountLatticeChart flow={flow} />
    </div>
  );
}
