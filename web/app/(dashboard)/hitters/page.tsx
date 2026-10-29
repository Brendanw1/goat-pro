import Link from "next/link";
import { sortComparator } from "@/lib/table-sort";
import { getHitters, getHitterPercentiles, getHitterSkillIndex, getSwingIndex, getSwingQAll } from "@/lib/data";
import { hittersProps } from "@/lib/boards/hitters";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { GradePctProvider } from "@/components/ui/grade-pct";
import { HittersTable } from "./table";
import { ApproachDial } from "@/components/ui/approach-dial";

export const metadata = { title: "Hitters" };

/**
 * Three views. `Rate` — the measured leaderboard (the default board).
 * `Swing` — bat tracking (2023 on, 100+ tracked swings): bat speed, length,
 * attack angle, swords, squared-up and blast rates per hitter-season.
 * `Skill` — the league-wide 20-80 skill board: every hitter's Power / Contact /
 * Eye estimates and approach dial, one row per hitter-season, the same grades
 * the profile cards carry (bake-side, from the scouting family's index).
 *
 * The skill view is server-rendered and link-driven: chips rewrite the query,
 * no client code.
 */

type Col = { key: string; label: string; dial?: boolean };
const SKILL_COLS: Col[] = [
  { key: "pa", label: "PA" },
  { key: "power", label: "Power" },
  { key: "contact", label: "Contact" },
  { key: "eye", label: "Eye" },
  { key: "approach", label: "Approach", dial: true },
];
const TYPE_SHORT: Record<string, string> = {
  "Slugger — the damage carries the profile": "Slugger",
  "Damage-first — big impact, big misses": "Damage-first",
  "Contact — puts the bat on the ball, leans on singles": "Contact",
  "Offensive lean-down — contact without impact yet": "Lean-down",
  "Balanced — no carrying tool this season": "Balanced",
};

const SWING_COLS: Col[] = [
  { key: "sq", label: "SQ" },
  { key: "avgBatSpeed", label: "Bat mph" },
  { key: "batSpeedP90", label: "Peak 90th" },
  { key: "swingLength", label: "Length ft" },
  { key: "attackAngle", label: "Attack°" },
  { key: "whiffPerSwing", label: "Whiff/sw" },
  { key: "swords", label: "Swords" },
  { key: "swordRate", label: "Sword%" },
  { key: "squaredUpPerSwing", label: "Sq-up%" },
  { key: "blastPerSwing", label: "Blast%" },
  { key: "hardSwingRate", label: "Hard-sw%" },
  { key: "n", label: "Swings" },
];

const fmtG = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "—");

export default async function HittersPage({ searchParams }: {
  searchParams?: Promise<{ view?: string; season?: string; team?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const q = (await searchParams) ?? {};
  const view = q.view === "skill" ? "skill" : q.view === "swing" ? "swing" : "rate";
  const data = await getHitters();
  const { meta, initial } = hittersProps(data);
  const percentiles = await getHitterPercentiles();

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { view, ...(q as Record<string, string>), page: "0", ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/hitters?${p.toString()}`;
  };

  if (view === "skill") {
    const index = await getHitterSkillIndex();
    const seasons: number[] = Object.keys(index?.seasons ?? {}).map(Number).sort((a, b) => b - a);
    const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
    const byId = new Map((data ?? []).map((r: any) => [String(r.id), r]));
    let rows: any[] = (index?.seasons?.[String(season)] ?? []).map((r: any) => {
      const b = byId.get(String(r.id));
      return { ...r, name: b?.name ?? r.id, team: b?.team ?? null, bats: b?.bats ?? null };
    });
    if (q.team) rows = rows.filter((r) => r.team === q.team);
    const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort() as string[];
    const sortKey = SKILL_COLS.some((c) => c.key === q.sort) ? q.sort! : "power";
    const asc = sortKey === "eye";
    const dir = q.dir === "asc" || q.dir === "desc" ? q.dir : asc ? "asc" : "desc";
    rows.sort(sortComparator(sortKey, dir));
    const PAGE = 50;
    const page = Math.max(0, Number(q.page) || 0);
    const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Hitters — skill</h1>
        <div className="flex flex-wrap items-center gap-2 animate-fade-up">
          <DescriptiveChip />
          <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
        </div>
        <p className="text-xs text-text-dim max-w-[75ch]">
          Skill estimates on the site&apos;s descriptive 20-80 scale: percentile rank among this season&apos;s 50+ PA
          hitters, read as a scout grade. Approach is a style dial, not a grade — the free swinger and the take-first
          hitter are different, not better and worse. Types come off the power-contact axes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/hitters" className={chip(false)}>Rate board</Link>
          <span className="w-px h-4 bg-border-subtle mx-1" />
          {seasons.map((s) => <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>)}
          <span className="w-px h-4 bg-border-subtle mx-1" />
          <Link href={link({ team: undefined, page: undefined })} className={chip(!q.team)}>All teams</Link>
          {teams.map((t) => <Link key={t} href={link({ team: t })} className={chip(q.team === t)}>{t}</Link>)}
        </div>
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs font-data">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="px-4 py-2 text-left font-semibold">Player</th>
                  <th className="px-2 py-2 text-left font-semibold">Team</th>
                  <th className="px-2 py-2 text-left font-semibold">Bats</th>
                  {SKILL_COLS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortKey ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                      <Link href={link({ sort: c.key, dir: c.key === sortKey ? (dir === "desc" ? "asc" : "desc") : undefined })} className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}{c.key === sortKey ? (dir === "desc" ? " ▼" : " ▲") : ""}</Link>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-left font-semibold">Type</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r: any) => (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 font-sans">
                      <Link href={`/player/${r.id}?season=${season}`} className="text-text-primary hover:underline">{r.name}</Link>
                    </td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary">{r.team ?? "—"}</td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary">{r.bats ?? "—"}</td>
                    {SKILL_COLS.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                        {c.dial ? <div className="flex justify-end"><ApproachDial g={r.approach} size={64} /></div> : fmtG(r[c.key])}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 font-sans text-text-secondary" title={r.type ?? undefined}>
                      {r.type ? TYPE_SHORT[r.type] ?? r.type.split(" — ")[0] : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text-dim">
          <span>{rows.length.toLocaleString("en-US")} hitters</span>
          {page > 0 && <Link href={link({ page: String(page - 1) })} className="text-text-secondary hover:underline">← Previous</Link>}
          {(page + 1) * PAGE < rows.length && <Link href={link({ page: String(page + 1) })} className="text-text-secondary hover:underline">Next →</Link>}
        </div>
      </div>
    );
  }

  if (view === "swing") {
    const [index, swingq] = await Promise.all([getSwingIndex(), getSwingQAll()]);
    const seasons: number[] = Object.keys(index?.seasons ?? {}).map(Number).sort((a, b) => b - a);
    const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
    const byId = new Map((data ?? []).map((r0: any) => [String(r0.id), r0]));
    let rows: any[] = (index?.seasons?.[String(season)] ?? []).map((r0: any) => {
      const b = byId.get(String(r0.id));
      const sq = swingq?.rows?.[`${r0.id}-${season}`]?.g ?? null;
      return { ...r0, sq, name: b?.name ?? r0.id, team: b?.team ?? null, bats: b?.bats ?? null };
    });
    if (q.team) rows = rows.filter((r0) => r0.team === q.team);
    const teams = [...new Set(rows.map((r0) => r0.team).filter(Boolean))].sort() as string[];
    const sortKey = SWING_COLS.some((c) => c.key === q.sort) ? q.sort! : "avgBatSpeed";
    const asc = sortKey === "swordRate" || sortKey === "swords" || sortKey === "whiffPerSwing" || sortKey === "swingLength";
    const dir = q.dir === "asc" || q.dir === "desc" ? q.dir : asc ? "asc" : "desc";
    rows.sort(sortComparator(sortKey, dir));
    const PAGE = 50;
    const page = Math.max(0, Number(q.page) || 0);
    const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Hitters — swing</h1>
        <div className="flex flex-wrap items-center gap-2 animate-fade-up">
          <DescriptiveChip />
          <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
        </div>
        <p className="text-xs text-text-dim max-w-[75ch]">
          Statcast bat tracking, {season}: every hitter with 100+ tracked swings. Bat speed is our average over all
          tracked swings (Savant&apos;s leaderboard averages competitive swings only, so theirs reads about a point
          higher); swords, squared-up, blast and hard-swing rates are Savant&apos;s own. Swing length and attack angle
          are style — sortable, never coloured. SQ is the Swing Quality grade (100 = league, descriptive, §98; 25+ BIP).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/hitters" className={chip(false)}>Rate board</Link>
          <Link href={link({ view: "skill" })} className={chip(false)}>Skill board</Link>
          <Link href={link({ view: "swing" })} className={chip(true)}>Swing board</Link>
          <span className="w-px h-4 bg-border-subtle mx-1" />
          {seasons.map((s) => <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>)}
          <span className="w-px h-4 bg-border-subtle mx-1" />
          <Link href={link({ team: undefined, page: undefined })} className={chip(!q.team)}>All teams</Link>
          {teams.map((tm) => <Link key={tm} href={link({ team: tm })} className={chip(q.team === tm)}>{tm}</Link>)}
        </div>
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs font-data">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="px-4 py-2 text-left font-semibold">Player</th>
                  <th className="px-2 py-2 text-left font-semibold">Team</th>
                  <th className="px-2 py-2 text-left font-semibold">Bats</th>
                  {SWING_COLS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortKey ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                      <Link href={link({ sort: c.key, dir: c.key === sortKey ? (dir === "desc" ? "asc" : "desc") : undefined })} className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}{c.key === sortKey ? (dir === "desc" ? " ▼" : " ▲") : ""}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r0: any) => (
                  <tr key={r0.id} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 font-sans">
                      <Link href={`/player/${r0.id}?season=${season}&tab=swing`} className="text-text-primary hover:underline">{r0.name}</Link>
                    </td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary">{r0.team ?? "—"}</td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary">{r0.bats ?? "—"}</td>
                    {SWING_COLS.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                        {fmtG(r0[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text-dim">
          <span>{rows.length.toLocaleString("en-US")} hitters · 100+ tracked swings each</span>
          {page > 0 && <Link href={link({ page: String(page - 1) })} className="text-text-secondary hover:underline">← Previous</Link>}
          {(page + 1) * PAGE < rows.length && <Link href={link({ page: String(page + 1) })} className="text-text-secondary hover:underline">Next →</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Hitters</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/hitters" className={chip(true)}>Rate board</Link>
        <Link href={link({ view: "skill" })} className={chip(false)}>Skill board</Link>
        <Link href={link({ view: "swing" })} className={chip(false)}>Swing board</Link>
      </div>
      <p className="text-xs text-text-dim">
        Measured only: the slash line, batted-ball quality and plate discipline. wOBA uses weights derived from this
        site&apos;s own run-expectancy data (league average reads .310). No expected-stats model yet — that is what the
        Savant expected-stats board carries in the meantime.
      </p>
      <GradePctProvider data={null}>
        <HittersTable meta={meta} initial={initial} percentiles={percentiles} />
      </GradePctProvider>
    </div>
  );
}
