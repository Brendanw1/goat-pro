import { NextRequest, NextResponse } from "next/server";
import { getGameLog } from "@/lib/data";
import { badInput } from "@/lib/r2";

/** One player's game log (gzipped R2 file, decompressed server-side). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season");
  if (!season) {
    return NextResponse.json({ error: "season is required", code: "BAD_REQUEST" }, { status: 400 });
  }
  const bad = badInput(id, season);
  if (bad) return bad;
  const log = await getGameLog(id, season);
  if (!log) {
    return NextResponse.json({ error: `No game log: ${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(log);
}
