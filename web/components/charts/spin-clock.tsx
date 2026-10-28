"use client";

/**
 * Spin axis, as a clock face, one dot per pitch — the college chart, re-fed
 * from the bake. Statcast `spin_axis` uses the same clock the college chart
 * drew TrackMan with: 180° is 12:00 and pure backspin, 270° is 3:00 (checked
 * on the mart: RHP four-seamers mean ~215° ≈ 1:00, sliders ~90° ≈ 9:00). The
 * radius is spin rate, the other half of the same reading: a tight arc at a
 * high radius is a pitcher repeating a true spin; a smeared ring is one whose
 * release is inconsistent. Clock labels, not degrees — that is how the number
 * is spoken on a mound.
 */

import { useMemo } from "react";

const SIZE = 340;
const C = SIZE / 2;
const R = 126;

/** Statcast spin direction → a standard maths angle in radians, 12:00 up. */
function toMathRad(axisDeg: number): number {
  return ((270 - axisDeg) * Math.PI) / 180;
}

export function SpinClock({ dots, colorOf }: {
  dots: [string, number, number][] | null;
  colorOf: (t: string) => string;
}) {
  const view = useMemo(() => {
    const located = (dots ?? []).filter(([, axis]) => Number.isFinite(axis));
    const rpms = located.map(([, , rpm]) => rpm).filter((v) => v > 0);
    const lo = rpms.length ? Math.min(...rpms) : 0;
    const hi = rpms.length ? Math.max(...rpms) : 1;
    const span = hi - lo || 1;
    const radiusOf = (rpm: number) => 0.35 * R + ((rpm - lo) / span) * 0.65 * R;
    const pts = located.map(([t, axis, rpm]) => {
      const a = toMathRad(axis);
      const r = rpm > 0 ? radiusOf(rpm) : 0.35 * R;
      return { t, cx: C + r * Math.cos(a), cy: C - r * Math.sin(a), rpm, axis };
    });
    const rings = [lo, lo + span / 2, hi].map((v) => ({ v, r: radiusOf(v) }));
    const types = [...new Set(pts.map((p) => p.t))];
    return { pts, rings, lo, hi, types };
  }, [dots]);

  if (!view.pts.length) {
    return <p className="text-xs text-text-dim py-6">No tracked spin axis for this season.</p>;
  }

  const clockLabel = (text: string, deg: number) => {
    const a = toMathRad(deg);
    return (
      <text key={text} x={C + (R + 20) * Math.cos(a)} y={C - (R + 20) * Math.sin(a) + 3}
        textAnchor="middle" className="fill-text-dim font-data" fontSize="11">
        {text}
      </text>
    );
  };

  return (
    <div>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[420px] h-auto animate-fade-up" role="img"
        aria-label="Spin direction by pitch, radius is spin rate">
        <circle cx={C} cy={C} r={R} fill="none" stroke="currentColor" className="text-border-subtle" />
        {view.rings.map((rg, i) => (
          <g key={i}>
            <circle cx={C} cy={C} r={rg.r} fill="none" stroke="currentColor" className="text-border-subtle"
              strokeDasharray="2 4" strokeOpacity={0.6} />
          </g>
        ))}
        {clockLabel("12:00", 180)}
        {clockLabel("3:00", 270)}
        {clockLabel("6:00", 0)}
        {clockLabel("9:00", 90)}
        {view.pts.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={2.4} fill={colorOf(p.t)} fillOpacity={0.55}>
            <title>{`${p.t} · ${p.axis}° · ${p.rpm} rpm`}</title>
          </circle>
        ))}
        <text x={C} y={SIZE - 4} textAnchor="middle" className="fill-text-dim" fontSize="9" letterSpacing="0.08em">
          {`RINGS ${Math.round(view.lo)}–${Math.round(view.hi)} RPM`}
        </text>
      </svg>
      <p className="text-[10px] text-text-dim mt-2 leading-[1.5] max-w-[84ch]">
        Angle is the spin direction a ball leaves his hand with (12:00 = pure backspin); radius is spin rate between
        the ring values. A tight arc is a repeatable release; a smeared ring is not.
      </p>
    </div>
  );
}
