import Link from "next/link";
import { getAgingCurves, getDeclineIndex, getProspectAging } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Aging curves" };

type Q = { metric?: string; dir?: string };

/**
 * Aging (depth list item 7): the league's curves by age — FF velocity, bat
 * speed, average exit velocity and wOBA, one dot per qualified player-season
 * pooled 2020-26, equal weight per season. Survival bias is the honest
 * co-star: each age's pool is only the players good enough to still be there,
 * so the raw curve mixes aging with selection. The decline board is the
 * measured early-warning read (YoY FF velo with IL context); the Bayesian
 * changepoint version is model-lane. The prospect bridges answer the owner's
 * question: how draft age and Pipeline tier set the debut clock and the arc.
 */

const METRICS = [
  { key: "ffVelo", label: "FF velocity", nd: 1 },
  { key: "batSpeed", label: "Bat speed", nd: 1 },
  { key: "ev", label: "Exit velocity", nd: 1 },
  { key: "woba", label: "wOBA", nd: 3 },
  { key: "sprint", label: "Sprint speed (Sav)", nd: 1 },
];

const fmt = (v: unknown, nd = 1): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(nd) : "—";

function CurveChart({ pts, nd }: { pts: any[]; nd: number }) {
  if (!pts?.length) return null;
  const W = 940, H = 170, PL = 34, PR = 12, PT = 14, PB = 18;
  const xs = pts.map((p) => p.age);
  const ys = pts.map((p) => p.mean);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys) - (Math.max(...ys) - Math.min(...ys)) * 0.15 - 0.02;
  const y1 = Math.max(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.1 + 0.02;
  const px = (v: number) => PL + ((v - x0) / (x1 - x0)) * (W - PL - PR);
  const py = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${px(p.age).toFixed(1)},${py(p.mean).toFixed(1)}`).join("");
  const ticks: number[] = [];
  for (let v = Math.ceil(y0 * 10) / 10; v <= y1; v += (y1 - y0) / 4) ticks.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="league curve by age">
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={PL} y1={py(v)} x2={W - PR} y2={py(v)} stroke="#8b93a7" strokeWidth={0.4} opacity={0.25} />
          <text x={PL - 5} y={py(v) + 3} textAnchor="end" fontSize={9} fill="#8b93a7">{v.toFixed(nd)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#e3b341" strokeWidth={1.8} />
      {pts.map((p) => (
        <circle key={p.age} cx={px(p.age)} cy={py(p.mean)}
          r={Math.max(1.5, Math.min(5, Math.sqrt(p.n / 40)))} fill="#e3b341" opacity={0.8} />
      ))}
      {pts.filter((_, i) => i % 2 === 0).map((p) => (
        <text key={p.age} x={px(p.age)} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#8b93a7">{p.age}</text>
      ))}
    </svg>
  );
}

export default async function AgingPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const [curves, decline, prospect] = await Promise.all([getAgingCurves(), getDeclineIndex(), getProspectAging()]);
  const metric = METRICS.find((m) => m.key === q.metric) ?? METRICS[0];
  const biggestDrops = q.dir !== "gainers";
  const rows: any[] = [...(decline?.pitchers ?? [])].sort((a, b) =>
    biggestDrops ? (a.delta ?? 0) - (b.delta ?? 0) : (b.delta ?? 0) - (a.delta ?? 0));

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { metric: metric.key, dir: biggestDrops ? "drops" : "gainers", ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/aging?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Aging curves</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[85ch]">
        The league by age, pooled 2020-26 — one dot per qualified player-season (100+ fastballs, 100+ tracked swings,
        50+ balls in play, 100+ PA for wOBA), so a full season is one point whatever its size. Survival bias is the
        co-star of every aging curve: at 38 the pool is only the players who were still worth a roster spot, which is
        why the tail flattens. Dot size is seasons behind the point.
      </p>
      <div className="glass-panel p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {METRICS.map((m) => (
              <Link key={m.key} href={link({ metric: m.key })} className={chip(m.key === metric.key)}>{m.label}</Link>
            ))}
          </div>
        </div>
        <CurveChart pts={curves?.[metric.key] ?? []} nd={metric.nd} />
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            The decline read — latest-season FF velocity vs the year before
          </h2>
          <div className="flex gap-1.5">
            <Link href={link({ dir: "drops" })} className={chip(biggestDrops)}>biggest drops</Link>
            <Link href={link({ dir: "gainers" })} className={chip(!biggestDrops)}>biggest gains</Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <SortableTable className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <SortTh className="px-4 py-2 text-left font-semibold">Pitcher</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Season</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Age</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">FF velo</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Prev</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Δ</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">IL moves</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r) => (
                <tr key={`${r.id}-${r.season}`} className="border-t border-white/[0.04]">
                  <td className="px-4 py-1.5 font-sans">
                    <Link prefetch={false} href={`/player/${r.id}?season=${r.season}&tab=fatigue`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-dim">{r.season}</td>
                  <td className="px-2 py-1.5 text-right text-text-dim">{r.age}</td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">{fmt(r.ffVelo)}</td>
                  <td className="px-2 py-1.5 text-right text-text-dim" data-sort={r.prevFfVelo ?? ""}>{fmt(r.prevFfVelo)} ({r.prevSeason})</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: (r.delta ?? 0) < 0 ? "#e0654f" : "#5ba88f" }}>
                    {(r.delta ?? 0) > 0 ? "+" : ""}{fmt(r.delta)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-dim">{r.ilMoves || "—"}</td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        </div>
        <div className="px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          Both seasons at 100+ fastballs. A drop with IL moves beside it is a different story than one without —
          descriptive context, not the changepoint model (model-lane).
        </div>
      </div>
      {prospect && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass-panel p-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
              Draft age sets the clock — 2011-2026 drafts
            </h2>
            <table className="w-full text-xs font-data">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                  <th className="py-1 text-left font-semibold">Age at draft</th>
                  <th className="py-1 text-right font-semibold">Picks</th>
                  <th className="py-1 text-right font-semibold">Reached MLB</th>
                  <th className="py-1 text-right font-semibold">Median years</th>
                </tr>
              </thead>
              <tbody>
                {(prospect.draftAge ?? []).map((r: any) => (
                  <tr key={r.bucket} className="border-t border-white/[0.04]">
                    <td className="py-1 font-sans text-text-secondary">{r.bucket}</td>
                    <td className="py-1 text-right text-text-dim">{r.n.toLocaleString()}</td>
                    <td className="py-1 text-right text-text-primary">{fmt(r.reachedPct)}%</td>
                    <td className="py-1 text-right text-text-secondary">{r.medianYears ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-text-dim mt-2">
              The 18-and-under and 19-year-old buckets are the prep classes — longer clocks (median 6 years), and
              18-and-unders reach at a HIGHER rate than 22-year-old college seniors: teams invest picks where the
              ceiling is. 23+ draftees reach at 8%.
            </p>
          </div>
          <div className="glass-panel p-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
              Prospect tier sets the debut — first top-100 rank, 2011-2026
            </h2>
            <table className="w-full text-xs font-data">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                  <th className="py-1 text-left font-semibold">Tier</th>
                  <th className="py-1 text-right font-semibold">Reached MLB</th>
                  <th className="py-1 text-right font-semibold">Median debut age</th>
                  <th className="py-1 text-right font-semibold">wOBA at 24 / 27 / 30</th>
                </tr>
              </thead>
              <tbody>
                {(prospect.tiers ?? []).map((t: any) => {
                  const at = (a: number) => t.byAge?.find((x: any) => x.age === a)?.woba;
                  return (
                    <tr key={t.tier} className="border-t border-white/[0.04]">
                      <td className="py-1 font-sans text-text-secondary">{t.tier}</td>
                      <td className="py-1 text-right text-text-dim">{t.n}</td>
                      <td className="py-1 text-right text-text-primary">{t.medianDebutAge ?? "—"}</td>
                      <td className="py-1 text-right text-text-secondary">
                        {[fmt(at(24), 3), fmt(at(27), 3), fmt(at(30), 3)].join(" / ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-text-dim mt-2">
              Every tier&apos;s debuters, by the age of their first top-100 appearance; the wOBA row reads the
              post-debut arc (100+ PA seasons, 5+ seasons per cell, Savant scale).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
