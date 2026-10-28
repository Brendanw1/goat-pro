import { NextRequest, NextResponse } from "next/server";
import { getHitters } from "@/lib/data";
import { fromParams } from "@/lib/boards/shared";
import { HITTER_DEFAULTS, HITTER_FILTER_COLUMNS, HITTER_SORT_KEYS, queryHitters } from "@/lib/boards/hitters";

/** One page of /hitters. Same paged-board contract as the pitchers route. */
export async function GET(request: NextRequest) {
  const state = fromParams(request.nextUrl.searchParams, HITTER_DEFAULTS, HITTER_SORT_KEYS, HITTER_FILTER_COLUMNS);
  return NextResponse.json(queryHitters(await getHitters(), state));
}
