import { NextRequest, NextResponse } from "next/server";

/**
 * Resolve a Savant play id to its hosted clip (an mp4 on MLB's own CDN). Called only when someone clicks
 * play, so nothing is stored or pre-fetched; the page plays MLB's file directly. Cached a day at the edge.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("playId") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "playId must be a Savant play UUID", code: "BAD_REQUEST" }, { status: 400 });
  const page = `https://baseballsavant.mlb.com/sporty-videos?playId=${id}`;
  try {
    const r = await fetch(page, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 } });
    const html = r.ok ? await r.text() : "";
    const m = html.match(/https:\/\/sporty-clips\.mlb\.com\/[^"'\s<>]+?\.mp4/);
    const url = m ? m[0].replace(/&#x3D;/g, "=").replace(/&amp;/g, "&") : null;
    return NextResponse.json({ url, page }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch {
    return NextResponse.json({ url: null, page });
  }
}
