/**
 * The count lattice, ported from the college site (BaseballGOAT web/lib/count-lattice.ts) and fed from the
 * bake instead of raw pitches: visuals/p/{id}-{season}.json.gz `counts` = { all | R | L: { pa, c: { "b-s": node } } }.
 *
 * Twelve legal counts, seventeen edges, every interior count once (the count graph is not a tree). The PAs that
 * took (b,s) -> (b+1,s) are exactly the balls thrown at (b,s), and (b,s) -> (b,s+1) the strikes and sub-two-strike
 * fouls; a two-strike foul is a self-loop and is not drawn. K, BB, HBP and balls in play are terminal, so a node's
 * outflow falls short of what reached it by the PAs that ended there.
 *
 * `pa` per node is distinct PAs with a pitch at that count, so a PA a reliever joins mid-count counts where he
 * joined it, and the 0-0 share sits below 100% for a pitcher with inherited work.
 */
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

/** Pitches a node needs before it shows a mix: a donut reads as shape, and five pitches still answer "what does he go to here". */
export const NODE_FLOOR = 5;

export type EdgeKind = "ball" | "strike";
export interface LatticeEdge { from: string; to: string; kind: EdgeKind }

export const LATTICE_COUNTS: readonly string[] = (() => {
  const out: string[] = [];
  for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) out.push(`${b}-${s}`);
  return out;
})();

/** Derived, so the graph cannot disagree with the rules: a ball edge wherever balls < 3, a strike edge wherever strikes < 2. */
export const LATTICE_EDGES: readonly LatticeEdge[] = (() => {
  const out: LatticeEdge[] = [];
  for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) {
    const from = `${b}-${s}`;
    if (s < 2) out.push({ from, to: `${b}-${s + 1}`, kind: "strike" });
    if (b < 3) out.push({ from, to: `${b + 1}-${s}`, kind: "ball" });
  }
  return out;
})();

/** The 4x3 grid rotated 45 degrees: 0-0 on top, a strike moves down-left, a ball down-right; depth = pitches taken. */
export const latticePosition = (balls: number, strikes: number) => ({ x: balls - strikes, y: balls + strikes });

export interface MixSlice { pitchType: string; label: string; color: string; n: number; pct: number }
export interface CountNode {
  count: string; balls: number; strikes: number; x: number; y: number;
  n: number; reaching: number; mix: MixSlice[]; hasMix: boolean;
}
export interface FlowEdge extends LatticeEdge { n: number }
export interface CountFlow { nodes: CountNode[]; edges: FlowEdge[]; pitches: number; plateAppearances: number }

export interface BakedNode { n: number; pa?: number; m: [string, number][]; b: number; s: number }
export interface BakedSide { pa: number; c: Record<string, BakedNode> }
export type BakedCounts = Partial<Record<"all" | "R" | "L", BakedSide>>;

export function countFlow(side: BakedSide | null | undefined): CountFlow {
  const c = side?.c ?? {};
  const edges: FlowEdge[] = LATTICE_EDGES.map((e) => ({ ...e, n: (e.kind === "ball" ? c[e.from]?.b : c[e.from]?.s) ?? 0 }));
  const inflow = new Map<string, number>();
  for (const e of edges) inflow.set(e.to, (inflow.get(e.to) ?? 0) + e.n);
  const nodes = LATTICE_COUNTS.map((count): CountNode => {
    const [balls, strikes] = count.split("-").map(Number);
    const d = c[count];
    const n = d?.n ?? 0;
    const mix = (d?.m ?? []).map(([t, k]) => ({
      pitchType: t, label: PITCH_CONFIG[t as PitchType]?.label ?? t,
      color: PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591", n: k, pct: n ? (100 * k) / n : 0,
    }));
    // pre-2026-10-28 bakes carry no per-node pa: fall back to the college rule (0-0 = its pitches, else inflow)
    const reaching = d?.pa ?? (count === "0-0" ? n : inflow.get(count) ?? 0);
    return { count, balls, strikes, ...latticePosition(balls, strikes), n, reaching, mix, hasMix: n >= NODE_FLOOR };
  });
  const pitches = nodes.reduce((a, x) => a + x.n, 0);
  return { nodes, edges, pitches, plateAppearances: side?.pa || nodes[0].reaching };
}

/** Old bakes shipped one flat `{ "b-s": node }` map (both sides together); new ones split by side. */
export function bakedSides(counts: unknown): BakedCounts {
  if (!counts || typeof counts !== "object") return {};
  const o = counts as Record<string, unknown>;
  if (o.all && typeof o.all === "object" && "c" in (o.all as object)) return o as BakedCounts;
  return { all: { pa: 0, c: o as Record<string, BakedNode> } };
}
