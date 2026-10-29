/**
 * Profile strip: the player's season WPA line (from wpa_index, MLB or AAA) and, for 2026 MLB, his ABS
 * challenge record (Savant's challenge table). Savant's ABS rows carry no MLBAM id, so they are matched
 * by accent-folded name, with the team breaking a tie; an ambiguous name shows nothing.
 * Server component: only the two lines cross to the page.
 */
import Link from "next/link";
import { type Level, getWpaIndex, getSavantBoard, getWarIndex } from "@/lib/data";
import { fmtIp } from "@/lib/ip";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’]/g, "").toLowerCase().trim();
const sgn = (v: number, nd = 2) => `${v > 0 ? "+" : ""}${v.toFixed(nd)}`;

/** The hover card for the WAR line: each " · " part is one line of the tip (see hover-tip tipLines). */
function warTip(side: "hitters" | "pitchers", r: any, rank: number, of: number, rpw: number, season: string | number) {
  const head = `${r.war.toFixed(1)} WAR in ${season}, our own model (not Baseball-Reference or FanGraphs), #${rank} of ${of} ${side}`;
  if (side === "pitchers") {
    return [head,
      `Built from FIP: strikeouts, walks, HBP and home runs against the league run environment`,
      `${fmtIp(r.ip)} IP, FIP ${r.fip.toFixed(2)} (on the RA/9 scale, before the park adjustment)`,
      ...(r.gs < r.g / 2 && r.gmli ? [`Reliever: credit scaled by the leverage he entered in (gmLI ${r.gmli.toFixed(2)}, 1.00 = average)`] : []),
      `Runs become wins at ${rpw.toFixed(1)} runs per win`,
      `Method: RESULTS-MLB §85 and the glossary (WAR). Click for the league board`].join(" · ");
  }
  const fld = [r.range != null && `range ${sgn(r.range, 1)}`, r.framing && `framing ${sgn(r.framing, 1)}`,
    r.throwingRuns && `throwing ${sgn(r.throwingRuns, 1)}`, r.blockingRuns && `blocking ${sgn(r.blockingRuns, 1)}`].filter(Boolean).join(", ");
  const sum = r.bat + r.bsr + r.fld + r.posn + r.rep + r.lg;
  return [head,
    `Batting ${sgn(r.bat, 1)} runs vs an average hitter (park-adjusted)`,
    `Baserunning ${sgn(r.bsr, 1)} runs (Savant)`,
    `Fielding ${sgn(r.fld, 1)} runs${fld ? ` (${fld})` : ""}`,
    `Position ${sgn(r.posn, 1)} runs for where he played`,
    `Replacement + league ${sgn(r.rep + r.lg, 1)} runs (what an average player has over a replacement)`,
    `Total ${sgn(sum, 1)} runs ÷ ${rpw.toFixed(1)} runs per win = ${r.war.toFixed(1)} WAR`,
    `Method: RESULTS-MLB §85 and the glossary (WAR). Click for the league board`].join(" · ");
}

export async function WpaAbsStrip({ id, season, level, name, team }: {
  id: string; season: string | number; level: Level; name?: string | null; team?: string | null;
}) {
  const [index, abs, warIdx] = await Promise.all([getWpaIndex(level), level === "mlb" ? getSavantBoard("abs_challenges").catch(() => null) : null,
    level === "mlb" ? getWarIndex() : null]);
  const warDoc = warIdx?.seasons?.[String(season)];
  const wars = (["hitters", "pitchers"] as const).map((side) => {
    const rows: any[] = warDoc?.[side] ?? [];
    const r = rows.find((x) => String(x.id) === String(id));
    return r ? { side, r, rank: 1 + rows.filter((x) => x.war > r.war).length, of: rows.length, rpw: warDoc.rpw as number } : null;
  }).filter(Boolean) as { side: "hitters" | "pitchers"; r: any; rank: number; of: number; rpw: number }[];
  const doc = index?.seasons?.[String(season)] ?? {};
  const lines = (["hitters", "pitchers"] as const).map((side) => {
    const rows: any[] = doc[side] ?? [];
    const r = rows.find((x) => String(x.id) === String(id));
    if (!r) return null;
    const rank = 1 + rows.filter((x) => x.wpa > r.wpa).length;
    return { side, r, rank, of: rows.length };
  }).filter(Boolean) as { side: "hitters" | "pitchers"; r: any; rank: number; of: number }[];

  let a: any = null;
  if (abs && name && String(season) === "2026") {
    const hits = (abs.rows ?? []).filter((x: any) => String(x.season) === "2026" && fold(String(x.player)) === fold(name));
    a = hits.length === 1 ? hits[0] : hits.find((x: any) => x.team === team) ?? null;
  }
  if (!lines.length && !a && !wars.length) return null;
  const absRank = a ? 1 + (abs!.rows ?? []).filter((x: any) => x.season === a.season && x.runs > a.runs).length : 0;
  const tone = (v: number) => (v > 0 ? "#5ba88f" : v < 0 ? "#e0654f" : undefined);

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] font-data text-text-dim">
      {wars.map(({ side, r, rank, of, rpw }) => (
        <Link key={`war-${side}`} href={`/${side}?season=${season}&sortBy=war&sortDir=desc`} className="hover:text-text-secondary"
          title={warTip(side, r, rank, of, rpw, season)}>
          <span className="uppercase tracking-wider text-[10px]">WAR{wars.length > 1 ? (side === "hitters" ? " bat" : " pitch") : ""}</span>{" "}
          <span className="text-text-primary text-[12px]" style={{ color: tone(r.war) }}>{r.war.toFixed(1)}</span>
          <span> · #{rank} of {of}</span>
          {side === "hitters" ? (
            <span> · runs: bat {sgn(r.bat, 1)}, BsR {sgn(r.bsr, 1)}, field {sgn(r.fld, 1)}, pos {sgn(r.posn, 1)}, repl {sgn(r.rep + r.lg, 1)}</span>
          ) : (
            <span> · {fmtIp(r.ip)} IP · FIP {r.fip.toFixed(2)}{r.gs < r.g / 2 && r.gmli ? ` · gmLI ${r.gmli.toFixed(2)}` : ""}</span>
          )}
        </Link>
      ))}
      {lines.map(({ side, r, rank, of }) => (
        <Link key={side} href={`/wpa?season=${season}&side=${side}${level === "aaa" ? "&level=aaa" : ""}`} className="hover:text-text-secondary"
          title="Win probability added (descriptive: prices the situations he stepped into, not skill). Click for the league board.">
          <span className="uppercase tracking-wider text-[10px]">WPA{lines.length > 1 ? (side === "hitters" ? " bat" : " pitch") : ""}</span>{" "}
          <span className="text-text-primary text-[12px]" style={{ color: tone(r.wpa) }}>{sgn(r.wpa)}</span>
          <span> · #{rank} of {of}</span>
          {(r.wpaPlus ?? r.wpaMinus) != null && <span> · gained {(r.wpaPlus ?? r.wpaMinus).toFixed(2)}, lost {((r.wpaPlus ?? r.wpaMinus) - r.wpa).toFixed(2)}</span>}
          {r.lcWpa != null && <span> · late &amp; close {sgn(r.lcWpa)}{r.lcPa ? ` (${r.lcPa} PA)` : ""}</span>}
          <span> · {side === "hitters" ? `${r.pa} PA` : `${r.bf} BF`}</span>
        </Link>
      ))}
      {a && (
        <Link href="/abs" className="hover:text-text-secondary"
          title="ABS challenges he initiated in 2026 (Savant). Skill = runs gained beyond what the calls he chose to challenge should have yielded.">
          <span className="uppercase tracking-wider text-[10px]">ABS</span>{" "}
          <span className="text-text-primary">{a.overturns}/{a.challenges}</span> won ({Math.round(100 * a.win_rate)}%)
          <span> · net </span><span style={{ color: tone(a.runs) }}>{sgn(a.runs)} runs</span>
          <span> · #{absRank} of {abs!.rows.length}</span>
          {a.gained_vs_exp != null && <span> · skill {sgn(a.gained_vs_exp)}</span>}
        </Link>
      )}
    </div>
  );
}
