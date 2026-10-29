import Link from "next/link";
import { getWpaIndex } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";

export const dynamic = "force-dynamic";

export const metadata = { title: "Win probability" };

type Q = { season?: string; side?: string; sort?: string };

/**
 * The WPA boards (depth list item 6): win probability added per plate
 * appearance, batting-team framed — positive is good for the hitter, and the
 * pitcher board's wpa is the same sum with the sign flipped (runs of win
 * probability prevented). Late & close is the classic context split: inning 7
 * or later within one run. Descriptive by nature — WPA prices the situation a
 * player happened to step into, which is why it is never coloured as skill.
 */

const H_COLS = [
  { key: "wpa", label: "WPA" },
  { key: "wpaPlus", label: "WPA+" },
  { key: "lcWpa", label: "Late&close" },
  { key: "lcPa", label: "L&C PA" },
  { key: "pa", label: "PA" },
];
const P_COLS = [
  { key: "wpa", label: "WPA" },
  { key: "wpaMinus", label: "WPA−" },
  { key: "lcWpa", label: "Late&close" },
  { key: "bf", label: "BF" },
];

const fmt = (v: unknown, nd = 2): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(nd) : "—";

export default async function WpaPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const index = await getWpaIndex();
  const seasons = Object.keys(index?.seasons ?? {}).map(Number).sort((a, b) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const side = q.side === "pitchers" ? "pitchers" : "hitters";
  const doc = index?.seasons?.[String(season)] ?? {};
  const cols = side === "hitters" ? H_COLS : P_COLS;
  const rows: any[] = [...(doc[side] ?? [])];
  const sortKey = cols.some((c) => c.key === q.sort) ? q.sort! : "wpa";
  rows.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (typeof x !== "number" || typeof y !== "number") return 0;
    return y - x;
  });
  const swings = doc.topSwings ?? [];

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { season: String(season), side, sort: sortKey, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    return `/wpa?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Win probability</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Win probability added, per plate appearance, on the batting team&apos;s side of the ledger: what each
        hitter&apos;s PAs moved his team&apos;s chances by — and, flipped, what each pitcher prevented. Late &amp; close
        is inning 7 or later within one run. Descriptive: WPA pays for the situation a player steps into, so a
        middle reliever in high leverage reads differently than a starter with the same outing — that is the point.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s) => (
          <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ side: "hitters" })} className={chip(side === "hitters")}>Hitters</Link>
        <Link href={link({ side: "pitchers" })} className={chip(side === "pitchers")}>Pitchers</Link>
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Player</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-semibold">
                    <Link href={link({ sort: c.key })} className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-1.5 font-sans">
                    <Link href={`/player/${r.id}?season=${season}`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                      {fmt(r[c.key], c.key === "pa" || c.key === "bf" || c.key === "lcPa" ? 0 : 2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          <span>{rows.length.toLocaleString("en-US")} players · {side === "hitters" ? "50+ PA" : "50+ BF"} · top 50 shown</span>
          <span>positive = helped his team</span>
        </div>
      </div>
      {swings.length > 0 && (
        <div className="glass-panel p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            The season&apos;s biggest swings — {season}
          </h2>
          <div className="grid gap-1">
            {swings.slice(0, 10).map((s: any, i: number) => (
              <div key={i} className="flex items-baseline gap-2 text-[11px] border-b border-white/[0.03] py-1">
                <span className="font-data text-text-dim shrink-0">{s.date}</span>
                <Link href={`/games/${s.gid}`} className="font-data text-text-secondary hover:underline shrink-0">
                  {s.away}@{s.home}
                </Link>
                <span className="text-text-dim font-data shrink-0">{s.half === "Bot" ? "B" : "T"}{s.inning}</span>
                <span className="text-text-secondary leading-snug flex-1">
                  <Link href={`/player/${s.batterId}`} className="hover:underline">{s.batter}</Link>
                  {" — "}{s.des}
                </span>
                <span className="font-data shrink-0" style={{ color: (s.swing ?? 0) > 0 ? "#5ba88f" : "#e0654f" }}>
                  {(s.swing ?? 0) > 0 ? "+" : ""}{s.swing?.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
