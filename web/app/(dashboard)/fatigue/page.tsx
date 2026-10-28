import Link from "next/link";
import { getPitchers, getLoadIndex, type Level } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { logoUrl } from "@/lib/team-pixel";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fatigue — TTO, rest, velo fade" };

type Q = { season?: string; min?: string; sort?: string; order?: string };

/**
 * The fatigue board (depth list item 3): measured, descriptive — how much
 * velo, whiff and strikeouts a pitcher loses by the third time through the
 * order, and how far his four-seam fades by pitch 75–90 of a start. No model
 * grades; the drops are the same cells the profile Fatigue tab carries, so
 * the board can never show a number the profile does not.
 *
 * Sort direction is per column (a big velo drop is a fact either way — the
 * chips let you read both ends).
 */

const COLS = [
  { key: "veloDropTto", label: "Velo T1−T3", nd: 1, tip: "Average pitch velocity, 1st time through minus 3rd. Positive = slower by the third look. Needs 30+ PA in both." },
  { key: "whiffDropTto", label: "Whiff T1−T3", nd: 1, tip: "Whiff% on swings, 1st minus 3rd time through (points). Positive = misses fewer bats by the third look." },
  { key: "kDropTto", label: "K% T1−T3", nd: 1, tip: "Strikeout rate per PA, 1st minus 3rd time through (points)." },
  { key: "ffFade75", label: "FF fade 75", nd: 1, tip: "Four-seam velocity at pitches 76–90 of a start minus pitches 1–15. Positive = the fastball fades. Needs 30+ FF in both buckets." },
  { key: "veloT1", label: "Velo T1", nd: 1 },
  { key: "veloT3", label: "Velo T3", nd: 1 },
  { key: "nPitches", label: "Pitches", nd: 0 },
  { key: "nGames", label: "G", nd: 0 },
];

const fmt = (v: unknown, nd?: number): string =>
  typeof v === "number" && Number.isFinite(v) ? (nd != null ? v.toFixed(nd) : String(v)) : "—";

export default async function FatiguePage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const [pitchers, index] = await Promise.all([getPitchers(), getLoadIndex()]);
  const seasons = Object.keys(index?.seasons ?? {}).map(Number).sort((a, b) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const min = Number.isFinite(Number(q.min)) && q.min !== undefined ? Number(q.min) : 700;
  const sortCol = COLS.find((c) => c.key === q.sort) ?? COLS[0];
  const desc = q.order !== "asc";
  const byId = new Map((pitchers ?? []).map((r: any) => [String(r.id), r]));
  // eslint may infer row as any; keep the annotation explicit for the map below
  let rows: any[] = (index?.seasons?.[String(season)] ?? []).map((r: any) => {
    const b = byId.get(String(r.id));
    return { ...r, name: b?.name ?? r.id, team: b?.team ?? null };
  }).filter((r: any) => r.nPitches >= min);
  rows.sort((a, b) => {
    const x = a[sortCol.key], y = b[sortCol.key];
    if (x == null) return 1;
    if (y == null) return -1;
    return desc ? y - x : x - y;
  });
  const shown = rows.slice(0, 60);
  const lg = index?.league?.[String(season)] ?? {};

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { season: String(season), min: String(min), sort: sortCol.key, order: desc ? "desc" : "asc", ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/fatigue?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Fatigue — TTO, rest, velo fade</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[80ch]">
        How a pitcher&apos;s stuff holds up as the game goes on, measured on every pitch of the season: velocity,
        whiff and strikeouts lost by the <span className="text-text-secondary">third time through the order</span>,
        and the <span className="text-text-secondary">four-seam fade</span> by pitch 76–90 of a start. Descriptive —
        the third-time penalty mixes fatigue with the hitter&apos;s own looks, so the league&apos;s own decline sits
        underneath: {lg["1"]?.velo ?? "—"} → {lg["3"]?.velo ?? "—"} mph and {lg["1"]?.kPct ?? "—"}% → {lg["3"]?.kPct ?? "—"}% K by the third time through.
        Drops need 30+ PA in both looks; the fade needs 30+ fastballs in both buckets. {min}+ pitches.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s) => (
          <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {[400, 700, 1500].map((m) => (
          <Link key={m} href={link({ min: String(m) })} className={chip(m === min)}>{m}+ pitches</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ order: "desc" })} className={chip(desc)}>biggest drop first</Link>
        <Link href={link({ order: "asc" })} className={chip(!desc)}>holds up best</Link>
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Player</th>
                <th className="px-2 py-2 text-left font-semibold">Team</th>
                {COLS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-semibold">
                    <Link href={link({ sort: c.key })} className={c.key === sortCol.key ? "text-text-primary" : "hover:text-text-secondary"}
                      title={c.tip}>{c.label}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const crest = logoUrl(r.team);
                return (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 font-sans">
                      <Link href={`/player/${r.id}?season=${season}&tab=fatigue`} className="text-text-primary hover:underline">{r.name}</Link>
                    </td>
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
                        {fmt(r[c.key], c.nd)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          <span>{rows.length.toLocaleString("en-US")} pitchers · top 60 shown</span>
          <span>rows link the profile Fatigue tab</span>
        </div>
      </div>
    </div>
  );
}
