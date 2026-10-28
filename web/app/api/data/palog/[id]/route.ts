import { NextRequest, NextResponse } from "next/server";
import { getPaLog, type Level } from "@/lib/data";

/** One player's per-PA pitch sequences for a season (gzipped R2, decompressed server-side). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season");
  if (!season) {
    return NextResponse.json({ error: "season is required", code: "BAD_REQUEST" }, { status: 400 });
  }
  const level = (request.nextUrl.searchParams.get("level") ?? "mlb") as Level;
  const log = await getPaLog(id, season, level);
  if (!log) {
    return NextResponse.json({ error: `No PA log: ${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(log);
}
