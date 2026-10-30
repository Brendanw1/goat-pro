import { NextRequest, NextResponse } from "next/server";
import { getMovementLeague, type Level } from "@/lib/data";

/**
 * D-10: the league movement sample for one season — per type, a stride sample of hb/iv
 * (ints ×10, as baked). The movement explorer draws them as ghost dots behind a pitcher's.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const season = Number(q.get("season"));
  const level: Level = q.get("level") === "aaa" ? "aaa" : "mlb";
  const all = await getMovementLeague(level);
  const seasons: any = all?.seasons ?? {};
  const s = seasons[String(season)] ?? null;
  if (!s) return NextResponse.json({ error: "no league sample for that season" }, { status: 404 });
  return NextResponse.json({ season, types: s }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
