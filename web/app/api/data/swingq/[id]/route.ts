import { NextRequest, NextResponse } from "next/server";
import { getSwingQAll } from "@/lib/data";

/** One hitter-season's Swing Quality grade + decomposition (RESULTS-MLB §98). ?season=YYYY. 404 = under the 25-BIP floor. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season") ?? "";
  if (!/^\d+$/.test(id) || !/^\d{4}$/.test(season)) return NextResponse.json({ error: "bad id or season" }, { status: 400 });
  const all = await getSwingQAll();
  const row = all?.rows?.[`${id}-${season}`];
  if (!row) return NextResponse.json({ error: `No swing quality row: ${id}-${season}`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ row, meta: all.meta }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
