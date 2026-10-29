import Link from "next/link";
import { sortComparator } from "@/lib/table-sort";
import { getSavantBoard } from "@/lib/data";
import { logoUrl } from "@/lib/team-pixel";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";

export const dynamic = "force-dynamic";

export const metadata = { title: "ABS challenges — 2026" };

type Q = { sort?: string; order?: string; min?: string };

/**
 * The ABS challenge era (depth list item 4): 2026 is the first MLB season
 * with the automated ball-strike challenge system — two challenges a game,
 * kept when the call is overturned, zones personalized to the hitter. This
 * page is Savant's published challenge table, re-published: who challenges,
 * who wins, and the run values — with the skill column front and centre.
 * "Gained vs expected" is what a challenger won beyond what the borderline
 * calls they chose should have yielded: the art of picking spots, per Savant's
 * own expectation. Reference numbers, labelled; nothing of ours.
 */

const COLS = [
  { key: "challenges", label: "Chal", nd: 0, tip: "Challenges initiated (batter, pitcher or catcher), 2026" },
  { key: "overturns", label: "Won", nd: 0, tip: "Challenges that overturned the call" },
  { key: "win_rate", label: "Win%", nd: 0, tip: "Share of challenges overturned" },
  { key: "runs_gained", label: "Runs +", nd: 2, tip: "Run value gained on overturned calls" },
  { key: "runs_cost", label: "Runs −", nd: 2, tip: "Run value lost on failed challenges" },
  { key: "runs", label: "Net runs", nd: 2, tip: "Net run value from challenging, Savant's runs above average" },
  { key: "gained_vs_exp", label: "Skill +", nd: 2, tip: "Runs gained beyond what the challenges taken should have yielded (Savant's expectation) — picking spots" },
  { key: "cost_vs_exp", label: "Skill −", nd: 2, tip: "Runs lost on failed challenges beyond expectation" },
];

const fmt = (v: unknown, nd?: number): string =>
  typeof v === "number" && Number.isFinite(v) ? (nd != null ? v.toFixed(nd) : String(v)) : "—";

export default async function AbsPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const board = await getSavantBoard("abs_challenges");
  const all: any[] = board?.rows ?? [];
  const min = Number.isFinite(Number(q.min)) && q.min !== undefined ? Number(q.min) : 10;
  const sortCol = COLS.find((c) => c.key === q.sort) ?? COLS.find((c) => c.key === "runs")!;
  const desc = q.order !== "asc";
  const players = all.filter((r) => Number(r.challenges ?? 0) >= min);
  players.sort(sortComparator(sortCol.key, desc ? "desc" : "asc"));
  // club roll-up: sum the run columns, weight the win rate by challenges
  const teams = new Map<string, { team: string; chal: number; won: number; runs: number; skill: number }>();
  for (const r of all) {
    const t = String(r.team ?? "—");
    const e = teams.get(t) ?? { team: t, chal: 0, won: 0, runs: 0, skill: 0 };
    e.chal += Number(r.challenges ?? 0);
    e.won += Number(r.overturns ?? 0);
    e.runs += Number(r.runs ?? 0);
    e.skill += Number(r.gained_vs_exp ?? 0);
    teams.set(t, e);
  }
  const teamRows = [...teams.values()].filter((t) => t.chal > 0).sort((a, b) => b.runs - a.runs);

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { sort: sortCol.key, order: desc ? "desc" : "asc", min: String(min), ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/abs?${p.toString()}`;
  };

  const lgWinRate = all.reduce((a, r) => a + Number(r.overturns ?? 0), 0)
    / Math.max(1, all.reduce((a, r) => a + Number(r.challenges ?? 0), 0));

  return (
    <div className="space-y-4">
      <h1 className="sr-only">ABS challenges</h1>
      <p className="text-xs text-text-dim max-w-[85ch] leading-relaxed">
        <span className="text-text-secondary font-medium">2026 is the challenge era.</span> Every ball-strike call can
        be challenged — two per team a game, kept when the call is overturned, on a zone personalized to the hitter
        (the system AAA trialed 2023–25). This table is Baseball Savant&apos;s published challenge record: who
        challenges, who wins (
        {Math.round(100 * lgWinRate)}% of challenges league-wide are overturned), and the run values. The skill
        columns are the storytelling: <span className="text-text-secondary">Skill +</span> is runs won beyond what the
        challenges taken should have yielded — the pick-your-spots art, per Savant&apos;s expectation. Reference
        numbers, labelled; the zone-shock read on our grades is a model-lane item.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {[5, 10, 20].map((m) => (
          <Link key={m} href={link({ min: String(m) })} className={chip(m === min)}>{m}+ challenges</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ order: "desc" })} className={chip(desc)}>most first</Link>
        <Link href={link({ order: "asc" })} className={chip(!desc)}>fewest first</Link>
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">The challengers — 2026</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Player</th>
                <th className="px-2 py-2 text-left font-semibold">Team</th>
                {COLS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortCol.key ? (desc ? "descending" : "ascending") : undefined}>
                    <Link href={link({ sort: c.key, order: c.key === sortCol.key && desc ? "asc" : "desc" })} className={c.key === sortCol.key ? "text-text-primary" : "hover:text-text-secondary"}
                      title={c.tip}>{c.label}{c.key === sortCol.key ? (desc ? " ▼" : " ▲") : ""}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.slice(0, 60).map((r) => {
                const crest = logoUrl(r.team);
                return (
                  <tr key={`${r.player}-${r.team}`} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 font-sans text-text-primary">{r.player}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        {crest ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={crest} alt="" width={14} height={14} className="rounded" />
                        ) : <PixelTeamLogo team={r.team} size={13} />}
                        {r.team ?? "—"}
                      </span>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortCol.key ? "text-text-primary" : "text-text-secondary"}`}>
                        {c.key === "win_rate" && typeof r[c.key] === "number"
                          ? `${Math.round(100 * r[c.key])}%`
                          : fmt(r[c.key], c.nd)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          <span>{players.length.toLocaleString("en-US")} challengers with {min}+ · top 60 shown</span>
          <span>Savant reference · 2026 regular season</span>
        </div>
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">By club — net runs from challenging</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Team</th>
                <th className="px-2 py-2 text-right font-semibold">Challenges</th>
                <th className="px-2 py-2 text-right font-semibold">Win%</th>
                <th className="px-2 py-2 text-right font-semibold">Net runs</th>
                <th className="px-2 py-2 text-right font-semibold">Skill +</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((t) => {
                const crest = logoUrl(t.team);
                return (
                  <tr key={t.team} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-1.5 font-sans text-text-secondary">
                        {crest ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={crest} alt="" width={14} height={14} className="rounded" />
                        ) : <PixelTeamLogo team={t.team} size={13} />}
                        {t.team}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-text-dim">{t.chal}</td>
                    <td className="px-2 py-1.5 text-right text-text-secondary">{Math.round(100 * t.won / Math.max(1, t.chal))}%</td>
                    <td className={`px-2 py-1.5 text-right ${t.runs >= 0 ? "text-[#5ba88f]" : "text-[#e0654f]"}`}>{t.runs.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right text-text-secondary">{t.skill.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
