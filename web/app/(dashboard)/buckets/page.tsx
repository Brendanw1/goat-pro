import Link from "next/link";
import { type Level, getBucketBoard, getHitters, getPitchers } from "@/lib/data";
import { sortComparator } from "@/lib/table-sort";
import { playedFor } from "@/lib/boards/shared";
import { TeamCrest } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Movement buckets" };

type Q = { season?: string; type?: string; axis?: string; bin?: string; side?: string; level?: string; sort?: string;
  order?: string; min?: string; team?: string };

/**
 * Movement buckets board: for one pitch type, cut by league quintiles of velocity, IVB or arm-side HB,
 * who throws that shape best (pitchers) and who handles it best (hitters' stuff faced). Rows from the
 * bake's buckets/{season}-{type}.json (30+ pitches in the bucket); names, team and age joined from the
 * season boards by (id, season). Descriptive.
 */
const TYPES = ["FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS"];
const AXES = [["v", "Velocity", " mph"], ["iv", "IVB", " in"], ["hb", "Arm-side HB", " in"]] as const;
const SEASONS = [2026, 2025, 2024, 2023];
const COLS = [
  { key: "age", label: "Age", nd: 0 },
  { key: "n", label: "Pitches", nd: 0 },
  { key: "share", label: "Share", nd: 1, tip: "share of his pitches of this type that fall in the bucket" },
  { key: "rv100", label: "RV/100", nd: 2, tip: "run value per 100 pitches in the bucket, good for him" },
  { key: "dRv", label: "vs lg", nd: 2, tip: "RV/100 minus the league's in this bucket, good for him" },
  { key: "whiff", label: "Whiff%", nd: 1 },
  { key: "xwcon", label: "xwOBAcon", nd: 3 },
];

const label = (e: number[], k: number, unit: string) =>
  k === 0 ? `< ${e[0]}${unit}` : k === e.length ? `${e[e.length - 1]}+${unit}` : `${e[k - 1]}–${e[k]}${unit}`;
const fmt = (v: unknown, nd: number) =>
  typeof v === "number" && Number.isFinite(v) ? (nd === 3 ? v.toFixed(3).replace(/^0/, "") : v.toFixed(nd)) : "—";

export default async function BucketsPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const level: Level = q.level === "aaa" ? "aaa" : "mlb";
  const season = SEASONS.includes(Number(q.season)) ? Number(q.season) : SEASONS[0];
  const type = TYPES.includes(q.type ?? "") ? q.type! : "FF";
  const axI = Math.max(0, AXES.findIndex((a) => a[0] === q.axis));
  const ax = AXES[axI];
  const side = q.side === "hitters" ? "hitters" : "pitchers";
  const [doc, board] = await Promise.all([getBucketBoard(season, type, level), side === "hitters" ? getHitters(level) : getPitchers(level)]);
  const edges: number[] = doc?.edges?.[ax[0]] ?? [];
  const bin = Math.min(edges.length, Math.max(0, Number.isFinite(Number(q.bin)) && q.bin !== undefined ? Number(q.bin) : edges.length));
  const lg = doc?.lg?.[ax[0]]?.[bin] ?? null;
  const lgRv = lg ? (side === "pitchers" ? lg.rv100 : -lg.rv100) : null;
  const byId = new Map((board ?? []).filter((r: any) => Number(r.season) === season).map((r: any) => [String(r.id), r]));
  const min = Number.isFinite(Number(q.min)) && q.min ? Number(q.min) : 60; // page default; the bake keeps 30+
  const rows: any[] = (doc?.rows ?? [])
    .filter((r: any[]) => r[1] === (side === "pitchers" ? 0 : 1) && r[2] === axI && r[3] === bin && r[4] >= min)
    .map((r: any[]) => {
      const b: any = byId.get(r[0]) ?? {};
      return { id: r[0], n: r[4], share: r[5], rv100: r[6], whiff: r[7], xwcon: r[8], dRv: lgRv !== null ? r[6] - lgRv : null,
        name: b.name ?? r[0], team: b.team ?? null, teams: b.teams ?? null, age: b.age != null ? Math.floor(b.age) : null };
    })
    .filter((r: any) => !q.team || playedFor(r, q.team));
  const sortKey = COLS.some((c) => c.key === q.sort) ? q.sort! : "rv100";
  const desc = q.order !== "asc";
  rows.sort(sortComparator(sortKey, desc ? "desc" : "asc"));
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort() as string[];

  const keep: Q = { level, season: String(season), type, axis: ax[0], bin: String(bin), side, sort: sortKey, order: desc ? "desc" : "asc", min: q.min, team: q.team };
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, String(v));
    return `/buckets?${p.toString()}`;
  };
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const profile = (id: string) => (level === "aaa" ? `/minors/player/${id}?season=${season}` : `/player/${id}?season=${season}`);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Movement buckets</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        One pitch type cut into five buckets by league quintiles of velocity, induced vertical break or arm-side horizontal break
        (fixed across seasons, rounded). <em>Pitchers</em>: how his pitches in the bucket played. <em>Hitters</em>: how he did
        against that shape (stuff faced). Run value is good-for-him per 100 pitches; &ldquo;vs lg&rdquo; subtracts the league&rsquo;s line in the
        same bucket. 60+ pitches in the bucket by default (down to 30 with Min pitches). Descriptive.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={link({ level: "mlb" })} className={chip(level === "mlb")}>MLB</Link>
        <Link href={link({ level: "aaa" })} className={chip(level === "aaa")}>AAA</Link>
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {SEASONS.map((s) => <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ side: "pitchers" })} className={chip(side === "pitchers")}>Pitchers</Link>
        <Link href={link({ side: "hitters" })} className={chip(side === "hitters")}>Hitters (stuff faced)</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <Link key={t} href={link({ type: t, bin: undefined })} className={chip(t === type)}>
            <span style={{ color: PITCH_CONFIG[t as PitchType]?.color }}>●</span> {t}
          </Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {AXES.map(([k, l]) => <Link key={k} href={link({ axis: k, bin: undefined })} className={chip(k === ax[0])}>{l}</Link>)}
      </div>
      {edges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {[...Array(edges.length + 1).keys()].map((k) => (
            <Link key={k} href={link({ bin: String(k) })} className={chip(k === bin)}>{label(edges, k, ax[2])}</Link>
          ))}
        </div>
      )}
      <form method="get" action="/buckets" className="flex flex-wrap items-center gap-3 text-[11px] text-text-dim">
        {(["level", "season", "type", "axis", "bin", "side", "sort", "order"] as const).map((k) => (keep[k] ? <input key={k} type="hidden" name={k} value={keep[k]} /> : null))}
        <label className="flex items-center gap-1">Team
          <select name="team" defaultValue={q.team ?? ""} className="rounded-md border border-border-subtle bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-primary">
            <option value="">All</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Min pitches
          <input name="min" type="number" min={30} step={10} defaultValue={q.min} placeholder="60"
            className="w-16 rounded-md border border-border-subtle bg-transparent px-1.5 py-0.5 text-[11px] font-data text-text-primary" />
        </label>
        <button type="submit" className={chip(false)}>Apply</button>
      </form>
      {!doc ? (
        <div className="glass-panel p-6 text-sm text-text-dim">No bucket board for {type} in {season}.</div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-2 text-[11px] text-text-dim border-b border-border-subtle">
            {type} {ax[1].toLowerCase()} {label(edges, bin, ax[2])} · league: {lg ? `${lg.n.toLocaleString("en-US")} pitches, RV/100 ${fmt(lgRv, 2)} (${side === "pitchers" ? "pitcher" : "hitter"} side), whiff ${fmt(lg.whiff, 1)}%, xwOBAcon ${fmt(lg.xwcon, 3)}` : "—"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs font-data">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="pl-4 pr-1 py-2 text-right font-semibold">#</th>
                  <th className="px-2 py-2 text-left font-semibold">Player</th>
                  <th className="px-2 py-2 text-left font-semibold">Team</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortKey ? (desc ? "descending" : "ascending") : undefined}>
                      <Link href={link({ sort: c.key, order: c.key === sortKey && desc ? "asc" : "desc" })} title={c.tip}
                        className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>
                        {c.label}{c.key === sortKey ? (desc ? " ▼" : " ▲") : ""}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 150).map((r, i) => (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="pl-4 pr-1 py-1.5 text-right text-text-dim">{i + 1}</td>
                    <td className="px-2 py-1.5 font-sans"><Link href={profile(r.id)} className="text-text-primary hover:underline">{r.name}</Link></td>
                    <td className="px-2 py-1.5"><span className="inline-flex items-center gap-1.5 text-text-secondary"><TeamCrest team={r.team} />{r.team ?? "—"}</span></td>
                    {COLS.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                        {c.key === "rv100" || c.key === "dRv" ? <Signed v={r[c.key]} dp={2} /> : fmt(r[c.key], c.nd)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">{rows.length.toLocaleString("en-US")} players · top 150 shown</div>
        </div>
      )}
    </div>
  );
}
