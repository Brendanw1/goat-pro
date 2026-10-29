import { NextRequest, NextResponse } from "next/server";
import { getArchetypesAll } from "@/lib/data";

/** One hitter-season's swing archetype + comps (RESULTS-MLB §94). ?season=YYYY. 404 = under the floor. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season") ?? "";
  if (!/^\d+$/.test(id) || !/^\d{4}$/.test(season)) return NextResponse.json({ error: "bad id or season" }, { status: 400 });
  const all = await getArchetypesAll();
  const row = all?.rows?.[`${id}-${season}`];
  if (!row) return NextResponse.json({ error: `No archetype row: ${id}-${season}`, code: "NOT_FOUND" }, { status: 404 });
  const { points: _p, rows: _r, ...rest } = all;
  return NextResponse.json({ row, meta: rest.meta, archetypes: rest.archetypes.map((a: any) => ({ id: a.id, label: a.label, n: a.n })) },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
