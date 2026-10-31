import { NextRequest, NextResponse } from "next/server";
import { getCatcher } from "@/lib/data";
import { badInput, fetchGzippedJson } from "@/lib/r2";

/** One player-season's catcher defense file (framing splits, blocking, throwing) (gzipped R2 file, decompressed server-side).
 *  `role=p`: the pitcher's running-game file (catcher/p/{id}-{season}.json.gz: Savant's board + CS against our xCS).
 *  404 = no file for that player-season. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season");
  if (!season) return NextResponse.json({ error: "season is required", code: "BAD_REQUEST" }, { status: 400 });
  const bad = badInput(id, season);
  if (bad) return bad;
  const pitcher = request.nextUrl.searchParams.get("role") === "p";
  const d = pitcher ? await fetchGzippedJson<any>(`catcher/p/${id}-${season}.json.gz`).catch(() => null) : await getCatcher(id, season);
  if (!d) return NextResponse.json({ error: `No ${pitcher ? "pitcher running" : "catcher"} file: ${id} (${season})`, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d);
}
