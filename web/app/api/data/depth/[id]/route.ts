import { NextRequest, NextResponse } from "next/server";
import { fetchGzippedJson } from "@/lib/r2";

/** One hitter-season contact-depth file (RESULTS-MLB §89). ?season=YYYY. 404 = under 100 competitive swings or pre-2024. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season") ?? "";
  if (!/^\d+$/.test(id) || !/^\d{4}$/.test(season)) return NextResponse.json({ error: "bad id or season" }, { status: 400 });
  const d = await fetchGzippedJson<any>(`depth/${id}-${season}.json.gz`).catch(() => null);
  if (!d) return NextResponse.json({ error: `No contact-depth file: ${id}-${season}`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
