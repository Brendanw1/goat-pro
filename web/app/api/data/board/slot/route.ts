import { NextRequest, NextResponse } from "next/server";
import { getArsenalBoardRows, getSlotBoard } from "@/lib/data";
import { fromParams } from "@/lib/boards/shared";
import { SLOT_DEFAULTS, SLOT_FILTER_COLUMNS, SLOT_SORT_KEYS, joinSlot, querySlot, slotPitchOf } from "@/lib/boards/slot";

/** One page of the /arsenal arm-slot board plus the band counts for the current filters. Why paged: lib/boards/shared.ts. */
export async function GET(request: NextRequest) {
  const state = fromParams(request.nextUrl.searchParams, SLOT_DEFAULTS, SLOT_SORT_KEYS, SLOT_FILTER_COLUMNS);
  // Allowlisted by slotPitchOf: the code becomes part of a storage path.
  const pt = slotPitchOf(state);
  const [arsenal, board] = await Promise.all([getArsenalBoardRows(pt), getSlotBoard()]);
  return NextResponse.json(querySlot(joinSlot(arsenal, board as any, pt), state));
}
