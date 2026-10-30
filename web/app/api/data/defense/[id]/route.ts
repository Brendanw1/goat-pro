import { NextRequest, NextResponse } from "next/server";
import { getDefense } from "@/lib/data";
import { badInput } from "@/lib/r2";

/** One player-season's site defense file (gzipped R2 file, decompressed server-side). 404 = no graded defense. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season");
  if (!season) return NextResponse.json({ error: "season is required", code: "BAD_REQUEST" }, { status: 400 });
  const bad = badInput(id, season);
  if (bad) return bad;
  const d = await getDefense(id, season);
  if (!d) return NextResponse.json({ error: `No defense file: ${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d);
}
