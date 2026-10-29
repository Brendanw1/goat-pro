import Link from "next/link";
import { getBucketBoard, getGameReport, getHitterProfile, getHitters, getPlayerProfile, getPostseason } from "@/lib/data";
import { PITCH_CONFIG } from "@/lib/constants";
import { gradeColor } from "@/lib/grades";
import { TeamCrest } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";
import type { PitchType } from "@/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Matchup" };

/**
 * Pitcher vs lineup (owner queue; after the Misiorowski vs Rays report in
 * vt_baseball/research/matchups). A scouting view built only from files the
 * site already bakes: the pitcher's arsenal and grades (players/), each
 * hitter's line vs the pitcher's hand and vs the pitch family (hitters/), and
 * each hitter's run value in the movement bucket each pitch sits in (buckets/).
 * Descriptive, not a forecast: it shows how each hitter has done against
 * pitches like these, with the sample beside every number.
 */

type Q = { pitcher?: string; team?: string; hitters?: string; game?: string; season?: string };

const FAMILY: Record<string, string> = { FF: "FB", SI: "FB", CT: "CT", SL: "BR", SW: "BR", CB: "BR", CH: "OS", FS: "OS" };
const FAMILY_NAME: Record<string, string> = { FB: "fastballs", CT: "cutters", BR: "breaking", OS: "offspeed" };
const AXES = [["v", "mph"], ["iv", "in IVB"], ["hb", "in arm-side"]] as const;
const d3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3).replace(/^0/, ""));
const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";

/** bin index the way the bake assigns it (numpy searchsorted, side="right") and its label */
const binOf = (edges: number[], x: number) => edges.filter((e) => x >= e).length;
const binLabel = (edges: number[], k: number, unit: string) =>
  k === 0 ? `<${edges[0]} ${unit}` : k === edges.length ? `${edges[k - 1]}+ ${unit}` : `${edges[k - 1]} to ${edges[k]} ${unit}`;

/** Read of one hitter vs one pitch: his run value per 100 in the pitch's buckets minus the league's there (hitter side). */
function read(diff: number | null, n: number): { text: string; tone: string } {
  if (diff == null || n < 30) return { text: "no read", tone: "text-text-dim" };
  const lean = n < 150 ? "leans " : "";
  if (diff >= 1) return { text: `${lean}handles it`, tone: "text-usf-green" };
  if (diff <= -1) return { text: `${lean}struggles`, tone: "text-[#e0654f]" };
  return { text: "near league", tone: "text-text-secondary" };
}

export default async function MatchupPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const pid = (q.pitcher ?? "").replace(/\D/g, "");
  const prof = pid ? await getPlayerProfile(pid, q.season || undefined) : null;
  if (!prof || !prof.pitches?.length) {
    // no pitcher yet: offer the latest postseason starters
    const ps = await getPostseason();
    const latest = Object.keys(ps?.seasons ?? {}).sort().pop();
    const recent = latest
      ? ps.seasons[latest].series.flatMap((s: any) => s.games.filter((g: any) => g.sp).map((g: any) => ({ ...g, label: s.label })))
        .sort((a: any, b: any) => b.date.localeCompare(a.date)).slice(0, 6)
      : [];
    return (
      <div className="glass-panel p-6 text-sm text-text-dim space-y-3">
        <p>{pid ? `No pitcher profile for ${pid}. ` : ""}Pick a pitcher: every pitcher profile and every postseason game has a Matchup link. The latest postseason starters:</p>
        <ul className="space-y-1 text-xs">
          {recent.map((g: any) => (
            <li key={g.gid} className="flex flex-wrap gap-3">
              <span className="w-40 text-text-dim">{g.label} G{g.n} · {g.date}</span>
              {(["away", "home"] as const).filter((side) => g.sp[side]).map((side) => (
                <Link key={side} href={`/matchup?pitcher=${g.sp[side].id}&game=${g.gid}&team=${side === "away" ? g.home : g.away}`}
                  className="text-text-secondary hover:underline">
                  {g.sp[side].n} vs {side === "away" ? g.home : g.away}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const season = String(prof.season);
  const throws: string = prof.throws ?? "R";

  // ---- the lineup: explicit ids, else a postseason game's starters, else the club's latest postseason lineup this season, else its top 9 by PA
  const allHitters = await getHitters();
  const seasonHitters = allHitters.filter((r) => String(r.season) === season);
  const teams = [...new Set(seasonHitters.map((r) => r.team).filter((t) => typeof t === "string"))].sort() as string[];
  const team = (q.team ?? "").toUpperCase();
  let ids: string[] = (q.hitters ?? "").split(",").map((x) => x.replace(/\D/g, "")).filter(Boolean).slice(0, 12);
  let source = ids.length ? "chosen lineup" : "";
  if (!ids.length && q.game && team) {
    const g = await getGameReport(q.game.replace(/\D/g, ""));
    const side = g?.away === team ? "away" : g?.home === team ? "home" : null;
    if (side && g.lineups) {
      ids = g.lineups[side].filter((b: any) => !b.sub).map((b: any) => String(b.id));
      source = `${team} starting lineup, ${g.series?.label ?? "game"}${g.series?.n ? ` game ${g.series.n}` : ""} (${g.d})`;
    }
  }
  if (!ids.length && team) {
    const lu = (await getPostseason())?.lineups?.[team];
    if (lu && String(lu.season) === season) {
      ids = lu.ids;
      source = `${team}'s latest postseason lineup (${lu.date})`;
    } else {
      ids = seasonHitters.filter((r) => r.team === team).sort((a, b) => (b.pa ?? 0) - (a.pa ?? 0)).slice(0, 9).map((r) => String(r.id));
      source = `${team}'s nine most-used hitters by ${season} PA`;
    }
  }

  // ---- pitcher arsenal + where each pitch sits in the league's buckets
  const arsenal = [...prof.pitches].filter((p: any) => (p.usage ?? 0) >= 3).sort((a: any, b: any) => (b.usage ?? 0) - (a.usage ?? 0));
  const boards = await Promise.all(arsenal.map((p: any) => getBucketBoard(season, p.pitchType)));
  const pitches = arsenal.map((p: any, i: number) => {
    const bd = boards[i];
    const raw: Record<string, number | null> = { v: p.velo ?? null, iv: p.ivb ?? null, hb: p.hb == null ? null : throws === "R" ? -p.hb : p.hb };
    const bins = bd ? AXES.map(([ax, unit], ai) => {
      const x = raw[ax];
      if (x == null || !bd.edges?.[ax]) return null;
      const k = binOf(bd.edges[ax], x);
      const lg = bd.lg?.[ax]?.[k];
      return { ax, ai, k, label: binLabel(bd.edges[ax], k, unit), lgRv: lg?.rv100 == null ? null : -lg.rv100, lgWhiff: lg?.whiff ?? null };
    }).filter(Boolean) as any[] : [];
    const want = new Set(ids);
    const hrows = new Map<string, any>();
    for (const r of bd?.rows ?? []) {
      if (r[1] !== 1 || !want.has(r[0])) continue;
      const b = bins.find((x) => x.ai === r[2] && x.k === r[3]);
      if (b) hrows.set(`${r[0]}|${b.ax}`, { n: r[4], rv: r[6], whiff: r[7], xwcon: r[8], diff: b.lgRv == null ? null : r[6] - b.lgRv });
    }
    return { ...p, bins, hrows };
  });

  const hitters = await Promise.all(ids.map((id) => getHitterProfile(id, season)));
  const chip = "rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            <Link href={`/player/${pid}?season=${season}`} className="hover:underline">{prof.name}</Link>
            <span className="text-text-dim"> vs </span>{source ? (team || "lineup") : "a lineup"}
          </h1>
          <p className="text-xs text-text-dim">
            {prof.team} · {throws}HP · {season} regular season{source ? ` · ${source}` : ""}
          </p>
        </div>
        <form method="get" action="/matchup" className="flex items-center gap-1">
          <input type="hidden" name="pitcher" value={pid} />
          <input type="hidden" name="season" value={season} />
          <select name="team" defaultValue={team} className="rounded-md border border-border-subtle bg-transparent px-2 py-1 text-[11px] text-text-secondary">
            <option value="">Opponent…</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className={chip}>Go</button>
        </form>
      </div>
      <p className="text-xs text-text-dim max-w-[90ch]">
        Scouting view, descriptive, not a forecast. For each pitch: where its velocity, induced vertical break and arm-side
        break sit among the league&apos;s {season} buckets for that pitch type, and for each hitter his run value per 100 pitches
        in those same buckets against the league&apos;s there (pitches from either hand; hitter side, + = good for the hitter).
        A read needs 30 pitches; under 150 it only &quot;leans&quot;. Family and hand lines are his {season} regular season.
      </p>

      {/* the pitcher's arsenal */}
      <div className="glass-panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2 text-left font-semibold">Pitch</th>
              <th className="py-2 text-right font-semibold" title="usage vs LHH / RHH">Use L/R</th>
              <th className="py-2 text-right font-semibold">Velo</th>
              <th className="py-2 text-right font-semibold">IVB</th>
              <th className="py-2 text-right font-semibold" title="arm-side horizontal break">Arm HB</th>
              <th className="py-2 text-right font-semibold">Whiff+</th>
              <th className="py-2 text-right font-semibold">Pitching+</th>
              <th className="py-2 text-right font-semibold">Whiff%</th>
              <th className="px-3 py-2 text-left font-semibold">League buckets it sits in (league whiff%)</th>
            </tr>
          </thead>
          <tbody>
            {pitches.map((p: any) => (
              <tr key={p.pitchType} className="border-t border-white/[0.04]">
                <td className="px-3 py-1.5 font-semibold" style={{ color: colorOf(p.pitchType) }}>{p.pitchType}</td>
                <td className="py-1.5 text-right text-text-secondary">{p.usageVsLHH?.toFixed(0) ?? "—"} / {p.usageVsRHH?.toFixed(0) ?? "—"}</td>
                <td className="py-1.5 text-right text-text-primary">{p.velo?.toFixed(1) ?? "—"}</td>
                <td className="py-1.5 text-right text-text-secondary">{p.ivb?.toFixed(1) ?? "—"}</td>
                <td className="py-1.5 text-right text-text-secondary">{p.hb == null ? "—" : (throws === "R" ? -p.hb : p.hb).toFixed(1)}</td>
                <td className="py-1.5 text-right" style={{ color: gradeColor(p.stuffPlus) }}>{p.stuffPlus?.toFixed(0) ?? "—"}</td>
                <td className="py-1.5 text-right" style={{ color: gradeColor(p.pitchingPlus) }}>{p.pitchingPlus?.toFixed(0) ?? "—"}</td>
                <td className="py-1.5 text-right text-text-secondary">{p.whiffPct?.toFixed(1) ?? "—"}</td>
                <td className="px-3 py-1.5 font-sans text-[10px] text-text-dim">
                  {p.bins.length ? p.bins.map((b: any) => `${b.label}${b.lgWhiff != null ? ` (${b.lgWhiff.toFixed(0)}%)` : ""}`).join(" · ") : "no buckets"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* the lineup */}
      {!hitters.length ? (
        <div className="glass-panel p-6 text-center text-sm text-text-dim">Pick an opponent above, or come from a postseason game&apos;s lineup.</div>
      ) : (
        <div className="glass-panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="px-3 py-2 text-left font-semibold">Hitter</th>
                <th className="py-2 text-right font-semibold" title={`vs ${throws}HP: PA · wOBA · K%`}>vs {throws}HP</th>
                <th className="py-2 pl-2 text-right font-semibold" title="usage-weighted bucket edge over this arsenal, RV/100 vs league (hitter side)">Arsenal</th>
                {pitches.map((p: any) => (
                  <th key={p.pitchType} className="px-2 py-2 text-left font-semibold" style={{ color: colorOf(p.pitchType) }}>{p.pitchType}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids.map((id, i) => {
                const h = hitters[i];
                const stand = h?.bats === "S" ? (throws === "R" ? "L" : "R") : h?.bats;
                const vh = (h?.vsHand ?? []).find((r: any) => r.v === throws);
                const cells = pitches.map((p: any) => {
                  const ax = AXES.map(([a]) => p.hrows.get(`${id}|${a}`)).filter(Boolean);
                  const n = ax.reduce((s: number, x: any) => s + x.n, 0);
                  const diff = ax.filter((x: any) => x.diff != null).length
                    ? ax.reduce((s: number, x: any) => s + (x.diff ?? 0) * x.n, 0) / Math.max(1, ax.filter((x: any) => x.diff != null).reduce((s: number, x: any) => s + x.n, 0))
                    : null;
                  const fam = (h?.vsFamily ?? []).find((r: any) => r.v === FAMILY[p.pitchType]);
                  const use = stand === "L" ? p.usageVsLHH : stand === "R" ? p.usageVsRHH : p.usage;
                  return { p, ax, n: ax.length ? Math.round(n / ax.length) : 0, diff, fam, use: use ?? p.usage ?? 0 };
                });
                const wsum = cells.filter((c) => c.diff != null && c.n >= 30).reduce((s, c) => s + c.use, 0);
                const edge = wsum ? cells.filter((c) => c.diff != null && c.n >= 30).reduce((s, c) => s + c.diff! * c.use, 0) / wsum : null;
                return (
                  <tr key={id} className="border-t border-white/[0.04] align-top">
                    <td className="px-3 py-2 font-sans">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 text-right font-data text-[10px] text-text-dim">{i + 1}</span>
                        {h?.team ? <TeamCrest team={h.team} size={13} /> : null}
                        <Link href={`/player/${id}?season=${season}`} className="text-text-primary hover:underline">{h?.name ?? id}</Link>
                        <span className="text-[10px] text-text-dim">{h?.bats ?? ""}</span>
                      </div>
                      {h ? (
                        <div className="pl-[18px] text-[10px] text-text-dim font-data">
                          {h.pa} PA · wOBA {d3(h.woba)} · K {h.kPct?.toFixed(0) ?? "—"}% · chase {h.oSwingPct?.toFixed(0) ?? "—"}%
                        </div>
                      ) : <div className="pl-[18px] text-[10px] text-text-dim">no {season} hitter file</div>}
                    </td>
                    <td className="py-2 text-right text-[10px]">
                      {vh ? <><div className="text-text-secondary">{d3(vh.woba)}</div><div className="text-text-dim">{vh.pa} PA · K {vh.kPct?.toFixed(0)}%</div></> : <span className="text-text-dim">—</span>}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {edge == null ? <span className="text-text-dim">—</span> : <Signed v={edge} dp={1} />}
                    </td>
                    {cells.map((c) => {
                      const r = read(c.diff, c.n);
                      return (
                        <td key={c.p.pitchType} className="px-2 py-2 text-[10px] leading-snug">
                          <div className={`font-sans ${r.tone}`}>{r.text}</div>
                          {c.ax.length ? (
                            <div className="text-text-dim" title="his RV/100 in this pitch's velo / IVB / arm-HB bucket minus the league's there; pitches seen per bucket">
                              {AXES.map(([a]) => {
                                const x = c.p.hrows.get(`${id}|${a}`);
                                return x ? <span key={a} className="mr-1.5"><Signed v={x.diff} dp={1} className="font-data" /><span className="text-text-dim"> ({x.n})</span></span> : null;
                              })}
                            </div>
                          ) : null}
                          {c.fam ? (
                            <div className="text-text-dim">vs {FAMILY_NAME[c.fam.v] ?? c.fam.v}: {d3(c.fam.woba)} · {c.fam.pa} PA</div>
                          ) : null}
                          <div className="text-text-dim">sees it {c.use.toFixed(0)}%</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-text-dim border-t border-border-subtle">
            Per pitch: the read, then his RV/100 minus the league&apos;s in the velo · IVB · arm-HB buckets (pitches seen), his wOBA
            against that pitch family (either hand), and how often this pitcher throws it to his side of the plate. Arsenal = those
            bucket edges weighted by that usage. vs {throws}HP = his line against {throws === "R" ? "right" : "left"}-handers.
          </p>
        </div>
      )}
    </div>
  );
}
