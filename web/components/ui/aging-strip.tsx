/**
 * By-age strip on profiles (depth item 7): his qualified seasons as dots on
 * the league's age curve — FF velocity for pitchers, bat speed and wOBA for
 * hitters. The league line carries the survival caveat (each age's pool is
 * only the players still worth a spot); his dots read against it, not against
 * a projection. Server component: the bake carries the dots.
 */

export function AgingStrip({ track, curves, role, season }: {
  track: any | null; curves: any | null; role: "pitcher" | "batter"; season?: string | number;
}) {
  const rows: any[] = track?.seasons ?? [];
  const field = role === "pitcher" ? "ffVelo" : rows.some((r) => r.batSpeed != null) ? "batSpeed" : "woba";
  // the league curve must be the one measured in the SAME field as his dots —
  // a wOBA dot on the bat-speed line is a nonsense axis.
  const curve: any[] | null = curves?.[field] ?? null;
  if (rows.length < 3 || !curve?.length) return null;
  const pts = rows.filter((r) => r[field] != null);
  if (pts.length < 3) return null;
  const nd = field === "woba" ? 3 : 1;
  const lg = curve.filter((p) => p.mean != null);
  const xs = [...lg.map((p) => p.age), ...pts.map((p) => p.age)];
  const ys = [...lg.map((p) => p.mean), ...pts.map((p) => p[field])];
  const W = 620, H = 120, PL = 30, PR = 10, PT = 10, PB = 16;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys) - 0.15 * (Math.max(...ys) - Math.min(...ys)) - 0.02;
  const y1 = Math.max(...ys) + 0.15 * (Math.max(...ys) - Math.min(...ys)) + 0.02;
  const px = (v: number) => PL + ((v - x0) / (x1 - x0)) * (W - PL - PR);
  const py = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const path = lg.map((p, i) => `${i ? "L" : "M"}${px(p.age).toFixed(1)},${py(p.mean).toFixed(1)}`).join("");
  const label = field === "ffVelo" ? "fastball velocity by age" : field === "batSpeed" ? "bat speed by age" : "wOBA by age (Savant scale)";
  return (
    <div className="glass-panel px-4 py-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">By age</span>
        <span className="text-[10px] text-text-dim">
          {label} — gold line: league (survival-biased pool), dots: his qualified seasons{season ? ` · through ${season}` : ""}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        <path d={path} fill="none" stroke="#e3b341" strokeWidth={1.4} opacity={0.55} />
        {pts.map((p) => (
          <g key={p.season}>
            <circle cx={px(p.age)} cy={py(p[field])} r={3} fill="#7da1c4" />
            <text x={px(p.age)} y={py(p[field]) - 6} textAnchor="middle" fontSize={8} fill="#7da1c4">{p[field].toFixed(nd).replace(/^0/, ".")}</text>
            <text x={px(p.age)} y={H - 4} textAnchor="middle" fontSize={8} fill="#8b93a7">{p.age}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
