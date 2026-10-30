import { NextRequest, NextResponse } from "next/server";
import { getDong } from "@/lib/data";
import { isId } from "@/lib/r2";

/** One batter's would-it-dong file (RESULTS-MLB §86). 404 = no ball that clears any park. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  const d = await getDong(id);
  if (!d) return NextResponse.json({ error: `No dong file: ${id}`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
