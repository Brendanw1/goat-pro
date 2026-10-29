"use client";
/**
 * A to-scale baseball field drawn in feet (x toward first base, y toward centre field, home at 0,0), the
 * spray chart's geometry: 90-ft bases, mound 60.5 ft, 95-ft infield arc, a generic fence 330 at the lines
 * and 400 to centre. Children draw in the same feet coordinates; `children(s)` gets the zoom scale
 * (1 = whole field) so marks can keep their screen size. Zoom with the presets, the wheel or
 * pinch-free +/- buttons; drag to pan. The y axis is flipped once here so children use plain feet.
 */
import { useRef, useState } from "react";

const fence = (deg: number) => 400 - 70 * (deg / 45) ** 2;
const dirt = (deg: number) => { const r = (deg * Math.PI) / 180; return 60.5 * Math.cos(r) + Math.sqrt(95 ** 2 - (60.5 * Math.sin(r)) ** 2); };
const P = (ft: number, deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [Math.round(ft * Math.sin(r) * 10) / 10, Math.round(ft * Math.cos(r) * 10) / 10];
};
const arc = (f: (d: number) => number) => Array.from({ length: 91 }, (_, i) => P(f(-45 + i), -45 + i));
const path = (pts: [number, number][], close = false) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${-y}`).join("") + (close ? "Z" : "");

export type View = { x: number; y: number; w: number; h: number };
export const VIEWS: Record<string, View> = {
  field: { x: -340, y: -425, w: 680, h: 445 },
  infield: { x: -150, y: -175, w: 300, h: 196 },
  outfield: { x: -340, y: -425, w: 680, h: 300 },
};

export function BallField({ children, initial = "field", label, height = 330 }: {
  children: (s: number) => React.ReactNode; initial?: keyof typeof VIEWS | View; label: string; height?: number;
}) {
  const [v, setV] = useState<View>(typeof initial === "string" ? VIEWS[initial] : initial);
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const zoom = (k: number, cx = v.x + v.w / 2, cy = v.y + v.h / 2) => {
    const w = Math.min(900, Math.max(60, v.w * k)), h = (w * v.h) / v.w;
    setV({ x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * h) / v.h, w, h });
  };
  const toFeet = (ev: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return [v.x + ((ev.clientX - r.left) / r.width) * v.w, v.y + ((ev.clientY - r.top) / r.height) * v.h];
  };
  const btn = "px-2 py-0.5 rounded border border-border-subtle text-[10px] text-text-secondary hover:bg-white/[0.05]";
  const fenceP = arc(fence), trackP = arc((d) => fence(d) - 15), dirtP = arc(dirt);
  const bag = (x: number, y: number) => <rect x={x - 1.25} y={-y - 1.25} width={2.5} height={2.5} fill="rgba(255,255,255,0.85)" transform={`rotate(45 ${x} ${-y})`} />;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {(["field", "infield", "outfield"] as const).map((k) => <button key={k} type="button" className={btn} onClick={() => setV(VIEWS[k])}>{k}</button>)}
        <button type="button" className={btn} onClick={() => zoom(0.7)} aria-label="zoom in">+</button>
        <button type="button" className={btn} onClick={() => zoom(1 / 0.7)} aria-label="zoom out">−</button>
        <span className="text-[10px] text-text-dim ml-1">scroll to zoom · drag to pan</span>
      </div>
      <svg ref={svg} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} className="w-full touch-none cursor-grab active:cursor-grabbing rounded bg-black/20"
        style={{ height }} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}
        onWheel={(e) => { const [cx, cy] = toFeet(e); zoom(e.deltaY < 0 ? 0.85 : 1 / 0.85, cx, cy); }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, v }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const r = svg.current!.getBoundingClientRect();
          setV({ ...d.v, x: d.v.x - ((e.clientX - d.x) / r.width) * d.v.w, y: d.v.y - ((e.clientY - d.y) / r.height) * d.v.h });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        <path d={path([[0, 0], ...fenceP], true)} fill="rgba(74,140,84,0.16)" />
        <path d={path([...fenceP, ...trackP.slice().reverse()], true)} fill="rgba(176,128,82,0.20)" />
        <path d={path([[0, 0], ...dirtP], true)} fill="rgba(176,128,82,0.22)" />
        <path d={path([[0, 0], [63.6, 63.6], [0, 127.3], [-63.6, 63.6]], true)} fill="rgba(74,140,84,0.22)" stroke="rgba(255,255,255,0.32)" strokeWidth={0.6} />
        <circle cx={0} cy={-60.5} r={9} fill="rgba(176,128,82,0.25)" />
        <path d={path(fenceP)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <path d={path([[0, 0], P(fence(-45), -45)])} stroke="rgba(255,255,255,0.32)" vectorEffect="non-scaling-stroke" />
        <path d={path([[0, 0], P(fence(45), 45)])} stroke="rgba(255,255,255,0.32)" vectorEffect="non-scaling-stroke" />
        {bag(63.6, 63.6)}{bag(0, 127.3)}{bag(-63.6, 63.6)}
        <path d="M-1.4 -1.4H1.4V0L0 1.4L-1.4 0Z" fill="rgba(255,255,255,0.85)" />
        {[-40, 0, 40].map((d) => { const [x, y] = P(fence(d) - 22, d); return <text key={d} x={x} y={-y} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.35)">{Math.round(fence(d))}</text>; })}
        {children(v.w / VIEWS.field.w)}
      </svg>
    </div>
  );
}
