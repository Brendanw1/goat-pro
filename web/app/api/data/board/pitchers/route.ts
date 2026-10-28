import { NextRequest, NextResponse } from "next/server";
import { getPitchers } from "@/lib/data";
import { fromParams } from "@/lib/boards/shared";
import { PITCHER_DEFAULTS, PITCHER_FILTER_COLUMNS, PITCHER_SORT_KEYS, queryPitchers } from "@/lib/boards/pitchers";

/** One page of /pitchers plus the league-median row. Why: lib/boards/shared.ts. */
export async function GET(request: NextRequest) {
  const state = fromParams(request.nextUrl.searchParams, PITCHER_DEFAULTS, PITCHER_SORT_KEYS, PITCHER_FILTER_COLUMNS);
  // getPitchers() derives rvGap, which the Luck column and its median read.
  return NextResponse.json(queryPitchers(await getPitchers(), state));
}
