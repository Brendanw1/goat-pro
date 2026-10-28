import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getHitterPercentiles, getHitterProfile, getPercentiles, getPlayerProfile } from "@/lib/data";
import { getPitcherPercentileRank, getStatPercentileRank, percentileColor } from "@/lib/percentiles";

/**
 * D-37: a shareable percentile card (PNG, 600 wide), Savant-style bars on this site's colour ramp.
 * /api/card/{id}?season=2025. Ranks are the profile's: same season population, same direction rules.
 */
const d3 = (v: number) => v.toFixed(3).replace(/^0/, "");
const p1 = (v: number) => v.toFixed(1) + "%";
const n1 = (v: number) => v.toFixed(1);
const HITTER: [string, string, (v: number) => string][] = [
  ["xwoba", "xwOBA", d3], ["xba", "xBA", d3], ["xslg", "xSLG", d3], ["ev90", "EV90", n1], ["barrelPct", "Barrel%", p1],
  ["hardHitPct", "Hard-hit%", p1], ["sweetSpotPct", "Sweet-spot%", p1], ["batSpeed", "Bat speed", n1],
  ["squaredUpPct", "Squared-up%", p1], ["oSwingPct", "Chase%", p1], ["whiffPct", "Whiff%", p1], ["kPct", "K%", p1],
  ["bbPct", "BB%", p1], ["sprintSpeed", "Sprint speed", n1],
];
const PITCHER: [string, string, (v: number) => string][] = [
  ["xwobaAg", "xwOBA", d3], ["xbaAg", "xBA", d3], ["xslgAg", "xSLG", d3], ["evAg", "Avg EV", n1],
  ["barrelPctAg", "Barrel%", p1], ["hardHitPctAg", "Hard-hit%", p1], ["kPct", "K%", p1], ["bbPct", "BB%", p1],
  ["whiffPct", "Whiff%", p1], ["chasePct", "Chase%", p1], ["cswPct", "CSW%", p1], ["gbPct", "GB%", p1], ["velo", "Avg velo", n1],
];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const season = request.nextUrl.searchParams.get("season") ?? undefined;
  const pitcher = await getPlayerProfile(id, season);
  const prof = pitcher ?? (await getHitterProfile(id, season));
  if (!prof) return new Response("not found", { status: 404 });
  const s = String(prof.season);
  const rows = pitcher
    ? await getPercentiles(s).then((p) => PITCHER.map(([k, l, f]) => ({ k, l, f, bp: p?.pitchers?.[k] })))
    : await getHitterPercentiles(s).then((p) => HITTER.map(([k, l, f]) => ({ k, l, f, bp: p?.by_season?.[s]?.[k] })));
  const shown = rows.filter((r) => r.bp && typeof prof[r.k] === "number").map((r) => ({
    ...r, v: prof[r.k] as number,
    rank: Math.round(pitcher ? getPitcherPercentileRank(r.k, prof[r.k], r.bp) : getStatPercentileRank(r.k, prof[r.k], r.bp)),
  }));
  const H = 110 + shown.length * 30 + 40;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: 600, height: H, background: "#0f1115", color: "#e8eaee", padding: 28 }}>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>{prof.name ?? id}</div>
        <div style={{ display: "flex", fontSize: 15, color: "#8a93a3", marginBottom: 18 }}>
          {`${s} ${pitcher ? "pitching" : "hitting"} percentiles${prof.team ? ` · ${prof.team}` : ""} · vs ${s} MLB ${pitcher ? "pitchers" : "hitters"}`}
        </div>
        {shown.map((r) => (
          <div key={r.k} style={{ display: "flex", alignItems: "center", height: 30 }}>
            <div style={{ display: "flex", width: 130, fontSize: 15, color: "#b8bfcc" }}>{r.l}</div>
            <div style={{ display: "flex", position: "relative", width: 330, height: 10, background: "#ffffff14", borderRadius: 5 }}>
              <div style={{ display: "flex", width: `${r.rank}%`, height: 10, background: percentileColor(r.rank), borderRadius: 5 }} />
            </div>
            <div style={{ display: "flex", width: 40, justifyContent: "center", fontSize: 15, fontWeight: 700, color: percentileColor(r.rank) }}>{r.rank}</div>
            <div style={{ display: "flex", width: 60, justifyContent: "flex-end", fontSize: 15, color: "#e8eaee" }}>{r.f(r.v)}</div>
          </div>
        ))}
        <div style={{ display: "flex", marginTop: 14, fontSize: 12, color: "#6b7383" }}>GOAT-Pro · public Statcast data · project-p0q8t.vercel.app</div>
      </div>
    ),
    { width: 600, height: H, headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
