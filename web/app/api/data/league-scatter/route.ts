import { NextRequest, NextResponse } from "next/server";
import { getHitters, getPitchers, type Level } from "@/lib/data";

/**
 * D-37: one season's qualified players as [id, name, xwOBA, wOBA] for the league scatter on the
 * profiles. Hitters: 100+ PA. Pitchers: 100+ batters faced, against. Slim on purpose: the profile
 * draws a few hundred dots and needs nothing else from the board rows.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const role = q.get("role") === "pitcher" ? "pitcher" : "hitter";
  const season = Number(q.get("season"));
  const level: Level = q.get("level") === "aaa" ? "aaa" : "mlb";
  const rows: any[] = role === "hitter" ? await getHitters(level) : await getPitchers(level);
  const [xk, yk, nk] = role === "hitter" ? ["xwoba", "wobaSavant", "pa"] : ["xwobaAg", "wobaAg", "battersFaced"];
  const pts = rows
    .filter((r) => Number(r.season) === season && (r[nk] ?? 0) >= 100 && r[xk] != null && r[yk] != null)
    .map((r) => [String(r.id), r.name ?? "", r[xk], r[yk]]);
  return NextResponse.json({ role, season, x: xk, y: yk, pts }, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}
