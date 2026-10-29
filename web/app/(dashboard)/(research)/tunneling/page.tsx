import Link from "next/link";
import { sortComparator } from "@/lib/table-sort";
import { getPitchers } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { fmtIp } from "@/lib/ip";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tunneling" };

type Q = { season?: string; min?: string; sort?: string; dir?: string };

/**
 * The tunneling board (T1, D-06): Tunnel+ — how well a pitcher's consecutive
 * pitches share a tunnel to the commit point, expressed as chase lift beyond
 * what his own chase rate predicts. Measured on real sequences; validated to
 * add information beyond prior chase (§74), which it does not beat head-on —
 * so it ships descriptive and reads as a trait, not a forecast.
 */

const COLS = [
  { key: "tunnelPlus", label: "Tunnel+", nd: 1, tip: "100 = average chase lift beyond his own chase rate, 10 points = one SD. Descriptive: it adds information beyond prior chase, and does not beat it." },
  { key: "tunnelPairsN", label: "Pairs", nd: 0, tip: "Consecutive pitch pairs of different types in one PA, this season" },
  { key: "tunnelReliability", label: "Rel", nd: 2, tip: "Split-half reliability of the season's tunnel estimate" },
  { key: "ip", label: "IP", nd: 1 },
  { key: "kPct", label: "K%", nd: 1 },
  { key: "chasePct", label: "Chase%", nd: 1 },
];

const fmt = (v: unknown, nd?: number): string =>
  typeof v === "number" && Number.isFinite(v) ? (nd != null ? v.toFixed(nd) : String(v)) : "—";

export default async function TunnelingPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const pitchers = await getPitchers();
  const seasons = [...new Set((pitchers ?? []).filter((r: any) => r.tunnelRankable).map((r: any) => r.season))].sort((a: number, b: number) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const min = Number.isFinite(Number(q.min)) && q.min !== undefined ? Number(q.min) : 30;
  const sortCol = COLS.find((c) => c.key === q.sort) ?? COLS[0];
  const dir = q.dir === "asc" || q.dir === "desc" ? q.dir : sortCol.key === "tunnelPlus" ? "desc" : "asc";
  const rows = (pitchers ?? [])
    .filter((r: any) => r.tunnelRankable && r.season === season && (r.tunnelPairsN ?? 0) >= min)
    .sort(sortComparator(sortCol.key, dir));
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { season: String(season), min: String(min), sort: sortCol.key, dir: q.dir, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/tunneling?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="sr-only">Tunneling</h1>
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[78ch]">
        <span className="text-text-secondary">Tunnel+</span> reads real sequences: consecutive pitches of different
        types in one plate appearance, measured for how well they share a tunnel to the batter&apos;s commit point
        (about 24 feet from the plate), expressed as the chase a pairing adds beyond the pitcher&apos;s own chase
        rate. It is a trait — §74 confirmed it carries information prior chase does not, and also that prior chase
        predicts better head-on — so read it as &quot;who is hard to pick up,&quot; not a forecast.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s2) => <Link key={s2} href={link({ season: String(s2) })} className={chip(s2 === season)}>{s2}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {[30, 100, 250].map((m) => (
          <Link key={m} href={link({ min: String(m) })} className={chip(m === min)}>{m === 30 ? "30+ pairs" : `${m}+ pairs`}</Link>
        ))}
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full min-w-max text-xs font-data">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
              <th className="px-4 py-2 text-left font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold">Pitcher</th>
              <th className="px-2 py-2 text-left font-semibold">Team</th>
              <th className="px-2 py-2 text-right font-semibold">Yr</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortCol.key ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                  <Link href={link({ sort: c.key, dir: c.key === sortCol.key ? (dir === "desc" ? "asc" : "desc") : undefined })} className={c.key === sortCol.key ? "text-text-primary" : "hover:text-text-secondary"}
                    title={c.tip}>{c.label}{c.key === sortCol.key ? (dir === "desc" ? " ▼" : " ▲") : ""}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r: any, i: number) => (
              <tr key={`${r.id}-${r.season}`} className="border-b border-white/[0.03]">
                <td className="px-4 py-1.5 text-text-dim">{i + 1}</td>
                <td className="px-2 py-1.5 font-sans">
                  <Link href={`/player/${r.id}?season=${r.season}`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                </td>
                <td className="px-2 py-1.5 text-text-secondary">{r.team ?? "—"}</td>
                <td className="px-2 py-1.5 text-right text-text-dim">{r.season}</td>
                <td className={`px-2 py-1.5 text-right ${c2(r.tunnelPlus, i)}`}>{fmt(r.tunnelPlus, 1)}</td>
                <td className="px-2 py-1.5 text-right text-text-secondary">{fmt(r.tunnelPairsN, 0)}</td>
                <td className="px-2 py-1.5 text-right text-text-dim">{fmt(r.tunnelReliability, 2)}</td>
                <td className="px-2 py-1.5 text-right text-text-secondary">{typeof r.ip === "number" ? fmtIp(r.ip) : "—"}</td>
                <td className="px-2 py-1.5 text-right text-text-secondary">{fmt(r.kPct, 1)}</td>
                <td className="px-2 py-1.5 text-right text-text-secondary">{fmt(r.chasePct, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="px-4 py-2 text-[10px] text-text-dim">Top 100 of {rows.length} rankable pitcher-seasons (rows need 30+ pairs to rank here). A player&apos;s per-pair table lives on his profile — Arsenal tab, Tunnels panel.</p>
      </div>
    </div>
  );
}

const c2 = (v: unknown, i: number): string =>
  typeof v === "number" ? (i < 3 ? "text-text-primary font-semibold" : "text-text-secondary") : "text-text-dim";
