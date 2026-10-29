/**
 * Profile strip: the player's season WPA line (from wpa_index, MLB or AAA) and, for 2026 MLB, his ABS
 * challenge record (Savant's challenge table). Savant's ABS rows carry no MLBAM id, so they are matched
 * by accent-folded name, with the team breaking a tie; an ambiguous name shows nothing.
 * Server component: only the two lines cross to the page.
 */
import Link from "next/link";
import { type Level, getWpaIndex, getSavantBoard } from "@/lib/data";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’]/g, "").toLowerCase().trim();
const sgn = (v: number, nd = 2) => `${v > 0 ? "+" : ""}${v.toFixed(nd)}`;

export async function WpaAbsStrip({ id, season, level, name, team }: {
  id: string; season: string | number; level: Level; name?: string | null; team?: string | null;
}) {
  const [index, abs] = await Promise.all([getWpaIndex(level), level === "mlb" ? getSavantBoard("abs_challenges").catch(() => null) : null]);
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
  if (!lines.length && !a) return null;
  const absRank = a ? 1 + (abs!.rows ?? []).filter((x: any) => x.season === a.season && x.runs > a.runs).length : 0;
  const tone = (v: number) => (v > 0 ? "#5ba88f" : v < 0 ? "#e0654f" : undefined);

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] font-data text-text-dim">
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
