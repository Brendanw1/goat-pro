import { NextRequest, NextResponse } from "next/server";
import { getPlaneHitter, getPlaneLeague } from "@/lib/data";

/** One hitter-season swing-plane file (RESULTS-MLB §90b) plus the league cell AA. ?season=YYYY. 404 = under 150 competitive swings. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season") ?? "";
  if (!/^\d+$/.test(id) || !/^\d{4}$/.test(season)) return NextResponse.json({ error: "bad id or season" }, { status: 400 });
  const d = await getPlaneHitter(id, season);
  if (!d) return NextResponse.json({ error: `No swing-plane file: ${id}-${season}`, code: "NOT_FOUND" }, { status: 404 });
  const lg = await getPlaneLeague();
  return NextResponse.json({ ...d, verdict: lg?.verdict?.P3 ?? null },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
