import { NextResponse } from "next/server";
import { getMinorsIndex, getMinorsLines, getPlayerIndex } from "@/lib/data";

/**
 * The nav search's player list, fetched once by the browser (owner 2026-10-04:
 * storage and speed). Rows of [id, name, team]; the browser caches it for an
 * hour. Pitchers (p) and hitters (h) come off the same player_index. Minor leaguers with no MLB entry follow as
 * [id, name, team, level, season] (latest season and level he appears in), linking to /minors/player/[id].
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const idx = await getPlayerIndex();
  const pitchers: [string, string, string][] = [];
  const hitters: [string, string, string][] = [];
  for (const [id, e] of Object.entries(idx ?? {}) as [string, any][]) {
    const row = [id, e.n ?? id, e.tm ?? ""] as [string, string, string];
    if (!row[1]) continue;
    (e.t === "H" ? hitters : pitchers).push(row);
  }
  const seen = new Set(Object.keys(idx ?? {}));
  const mi = await getMinorsIndex();
  for (const kind of ["pitchers", "hitters"] as const) {
    const out = kind === "hitters" ? hitters : pitchers;
    for (const season of [...(mi?.[kind] ?? [])].sort((a, b) => b - a)) {
      for (const r of (await getMinorsLines(kind, season))?.rows ?? []) {
        if (!r.id || !r.name || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push([r.id, r.name, r.team ?? "", r.level ?? "", String(season)] as any);
      }
    }
  }
  const byName = (a: [string, string, string], b: [string, string, string]) => a[1].localeCompare(b[1]);
  pitchers.sort(byName);
  hitters.sort(byName);
  return NextResponse.json({ h: hitters, p: pitchers }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
}
