import { NextRequest, NextResponse } from "next/server";
import { getArsenalBoardRows } from "@/lib/data";
import { PITCH_CONFIG } from "@/lib/constants";
import { fromParams } from "@/lib/boards/shared";
import { ARSENAL_DEFAULTS, ARSENAL_FILTER_COLUMNS, ARSENAL_SORT_KEYS, queryArsenal } from "@/lib/boards/arsenal";

/** One page of /arsenal/[pitch], rows enriched with age, Deception+ and ΔIVB/ΔHB vs slot. Why paged: lib/boards/shared.ts. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ pitch: string }> }) {
  const code = (await params).pitch.toUpperCase();
  // Allowlisted: the code becomes part of a storage path.
  if (!Object.hasOwn(PITCH_CONFIG, code)) {
    return NextResponse.json({ error: "Unknown pitch type", code: "BAD_PITCH" }, { status: 404 });
  }
  const state = fromParams(request.nextUrl.searchParams, ARSENAL_DEFAULTS, ARSENAL_SORT_KEYS, ARSENAL_FILTER_COLUMNS);
  return NextResponse.json(queryArsenal(await getArsenalBoardRows(code), state));
}
