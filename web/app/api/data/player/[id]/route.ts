import { NextRequest, NextResponse } from "next/server";
import { fetchFromR2 } from "@/lib/r2";
import type { PlayerProfile } from "@/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season") ?? undefined;

  // Pitcher profiles at players/, hitter docs (wave 2b) at hitters/.
  const profile = (await fetchFromR2<PlayerProfile>(`players/${id}.json`).catch(() => null))
    ?? (await fetchFromR2<any>(`hitters/${id}.json`).catch(() => null))
    ?? (season
      ? (await fetchFromR2<any>(`hitters/${id}-${season}.json`).catch(() => null))
      : null);

  if (!profile) {
    return NextResponse.json(
      { error: `Player not found: ${id}`, code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json(profile);
}
