import { NextResponse } from "next/server";
import { fetchFromR2 } from "@/lib/r2";

/** Contact-depth league references (RESULTS-MLB §89; pipeline/contact_depth.py). */
export async function GET() {
  const d = await fetchFromR2<any>("depth/league.json", { shared: true }).catch(() => null);
  if (!d) return NextResponse.json({ error: "No contact-depth league file", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(d, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
