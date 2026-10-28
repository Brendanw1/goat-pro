/**
 * Year-over-year delta on a profile header stat (depth wave): the same stat
 * from the career file's previous season, as a small signed chip. Direction is
 * per metric (K% up is good for a pitcher, down for a hitter). Hidden when the
 * previous season is too thin to compare (IP 20 / PA 50) — a delta off seven
 * innings is noise wearing an arrow.
 */
export function YoYDelta({ prev, cur, goodDir, fmt, minSample = 0, sample }: {
  prev: number | null | undefined;
  cur: number | null | undefined;
  goodDir: 1 | -1;
  fmt?: (v: number) => string;
  minSample?: number;
  sample?: number | null;
}) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return null;
  if (sample != null && sample < minSample) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return null;
  const good = d * goodDir > 0;
  return (
    <span className="block text-[9px] font-data leading-none mt-0.5"
      style={{ color: good ? "#5ba88f" : "#e0654f" }}
      title={`vs previous season: ${fmt ? fmt(prev) : prev}`}>
      {d > 0 ? "▲" : "▼"} {fmt ? fmt(Math.abs(d)) : Math.abs(d).toFixed(1)}
    </span>
  );
}
