import { NextResponse } from "next/server";
import { getPlayerIndex } from "@/lib/data";

/**
 * The nav search's player list, fetched once by the browser (owner 2026-10-04:
 * storage and speed). Rows of [id, name, team]; the browser caches it for an
 * hour. Pitchers (p) and hitters (h) come off the same player_index.
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
  const byName = (a: [string, string, string], b: [string, string, string]) => a[1].localeCompare(b[1]);
  pitchers.sort(byName);
  hitters.sort(byName);
  return NextResponse.json({ h: hitters, p: pitchers }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
