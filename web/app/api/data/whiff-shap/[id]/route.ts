import { NextRequest, NextResponse } from "next/server";
import { getWhiffShap } from "@/lib/data";

/** One player-season's Whiff+ breakdown (pipeline/whiff_shap.py) (gzipped R2 file, decompressed server-side). 404 = no breakdown. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season");
  if (!season) return NextResponse.json({ error: "season is required", code: "BAD_REQUEST" }, { status: 400 });
  const d = await getWhiffShap(id, season);
  if (!d) return NextResponse.json({ error: `No Whiff+ breakdown: ${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d);
}
