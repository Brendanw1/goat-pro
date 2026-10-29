import { NextRequest, NextResponse } from "next/server";
import { getPitchFile, type Level } from "@/lib/data";

/** One player-season's pitches for the explorer (gzipped R2, decompressed server-side). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const season = sp.get("season");
  const side = sp.get("side") === "H" ? "H" : "P";
  if (!season || !/^\d{4}$/.test(season) || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id and season are required", code: "BAD_REQUEST" }, { status: 400 });
  }
  const level = (sp.get("level") === "aaa" ? "aaa" : "mlb") as Level;
  const file = await getPitchFile(side, id, season, level);
  if (!file) {
    return NextResponse.json({ error: `No pitch file: ${side}${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(file);
}
