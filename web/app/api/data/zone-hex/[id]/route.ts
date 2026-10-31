import { NextRequest, NextResponse } from "next/server";
import { fetchGzippedJson } from "@/lib/r2";

/** One hitter-season's raw zone hex counts for the Smooth zone view (web_export.py zone_hex). ?season=YYYY&level=mlb|aaa. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const season = sp.get("season") ?? "";
  if (!/^\d+$/.test(id) || !/^\d{4}$/.test(season)) return NextResponse.json({ error: "bad id or season" }, { status: 400 });
  const pre = sp.get("level") === "aaa" ? "aaa/" : "";
  const d = await fetchGzippedJson<any>(`${pre}zone_hex/${id}-${season}.json.gz`).catch(() => null);
  if (!d) return NextResponse.json({ error: `No zone hex file: ${id}-${season}`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
