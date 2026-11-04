// team aggregates shared by the Overview and Identity tabs
export type Agg = { key: string; label: string; w: string; nd: number; good: 1 | -1; pct?: boolean };

/** One row per club: a mid-season mover's season row becomes his per-club lines (keys a line lacks drop out). */
export function byClub(rows: any[]): any[] {
  return rows.flatMap((r) => Array.isArray(r.teamSplits) && r.teamSplits.length > 1
    ? r.teamSplits.map((ln: any) => ({ id: r.id, name: r.name, season: r.season, throws: r.throws, bats: r.bats, ...ln }))
    : [r]);
}

export function teamMeans(rows: any[], aggs: Agg[]): Map<string, Record<string, number>> {
  const by = new Map<string, Record<string, [number, number]>>();
  for (const r of rows) {
    if (typeof r.team !== "string") continue;
    const t = by.get(r.team) ?? {};
    for (const a of aggs) {
      const v = r[a.key], w = r[a.w];
      if (typeof v !== "number" || typeof w !== "number" || !(w > 0)) continue;
      const [s, n] = t[a.key] ?? [0, 0];
      t[a.key] = [s + v * w, n + w];
    }
    by.set(r.team, t);
  }
  return new Map([...by].map(([team, t]) => [team, Object.fromEntries(Object.entries(t).map(([k, [s, n]]) => [k, s / n]))]));
}
