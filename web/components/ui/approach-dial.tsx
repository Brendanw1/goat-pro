/**
 * The approach dial (wave 9): swing rate drawn as a 20-80 style gauge — half
 * arc from 30 to 80, needle at the grade, with the word read under it. It is
 * a STYLE read, not a grade: the far-left hitter and the far-right hitter are
 * not good and bad, they are different hitters. Ported from the college
 * skill card's approach word (>= 57.5 swings more, <= 42.5 takes more).
 * Server-safe: pure SVG, no client code.
 */

export function approachWord(g: number | null): string {
  if (g == null) return "—";
  return g >= 57.5 ? "swings more" : g <= 42.5 ? "takes more" : "average swing rate";
}

export function ApproachDial({ g, size = 74 }: { g: number | null; size?: number }) {
  const w = size, h = size * 0.62, cx = w / 2, cy = h - 6, r = w / 2 - 7;
  const angleOf = (v: number) => Math.PI * (1 - (Math.max(30, Math.min(80, v)) - 30) / 50);
  const arc = (r0: number, r1: number) => {
    const a0 = angleOf(30), a1 = angleOf(80);
    const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy - rr * Math.sin(a)}`;
    return `M ${p(a0, r0)} A ${r0} ${r0} 0 0 1 ${p(a1, r0)} L ${p(a1, r1)} A ${r1} ${r1} 0 0 0 ${p(a0, r1)} Z`;
  };
  const needle = g != null ? angleOf(g) : null;
  const color = g == null ? "#8C9591" : g >= 57.5 ? "#e8761a" : g <= 42.5 ? "#3b9eff" : "#8b93a3";
  return (
    <svg viewBox={`0 0 ${w} ${h + 16}`} width={w} height={h + 16} role="img"
      aria-label={`Approach ${g ?? "—"}: ${approachWord(g)}`}>
      <path d={arc(r, r - 7)} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1} />
      <path d={arc(r - 9, r - 9)} fill="none" stroke="currentColor" className="text-border-subtle" strokeOpacity={0} />
      {needle != null && (
        <line x1={cx} y1={cy} x2={cx + (r - 2) * Math.cos(needle)} y2={cy - (r - 2) * Math.sin(needle)}
          stroke={color} strokeWidth={1.75} />
      )}
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
      <text x={cx} y={cy - r + 14} textAnchor="middle" fontSize="13" className="font-data font-bold"
        fill={g == null ? undefined : color}>{g ?? "—"}</text>
      <text x={cx} y={h + 12} textAnchor="middle" fontSize="8.5" className="fill-text-dim">{approachWord(g)}</text>
    </svg>
  );
}
