import { NextRequest, NextResponse } from "next/server";
import { getCatcher } from "@/lib/data";
import { badInput } from "@/lib/r2";

/** One player-season's catcher defense file (framing splits, blocking, throwing) (gzipped R2 file, decompressed server-side). 404 = not a catcher that season. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season");
  if (!season) return NextResponse.json({ error: "season is required", code: "BAD_REQUEST" }, { status: 400 });
  const bad = badInput(id, season);
  if (bad) return bad;
  const d = await getCatcher(id, season);
  if (!d) return NextResponse.json({ error: `No catcher file: ${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d);
}
