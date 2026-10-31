import { NextRequest, NextResponse } from "next/server";
import { fetchGzippedJson } from "@/lib/r2";
import { sumHex, typesOf } from "@/lib/zone-hex";

/**
 * The league's raw zone hex counts for one season x batter side x pitcher hand (R, L, A) x split
 * ('' / FB / BR / OS / a site type), summed server-side so the browser gets one sparse surface.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const season = sp.get("season") ?? "", stand = sp.get("stand") ?? "", hand = sp.get("hand") ?? "", split = sp.get("split") ?? "";
  if (!/^\d{4}$/.test(season) || !/^[RL]$/.test(stand) || !/^[RLA]$/.test(hand) || !/^(|FB|BR|OS|FF|SI|CT|SL|SW|CB|CH|FS)$/.test(split)) {
    return NextResponse.json({ error: "bad season, stand, hand or split" }, { status: 400 });
  }
  const pre = sp.get("level") === "aaa" ? "aaa/" : "";
  const d = await fetchGzippedJson<any>(`${pre}zone_hex/league-${season}.json.gz`).catch(() => null);
  const st = d?.st?.[stand];
  if (!st) return NextResponse.json({ error: `No league zone hex: ${season}`, code: "NOT_FOUND" }, { status: 404 });
  const hands = hand === "A" ? ["R", "L"] : [hand];
  const surf = sumHex(hands.flatMap((h) => typesOf(split).map((t) => st[h]?.[t])));
  return NextResponse.json(surf ?? { i: [] }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
