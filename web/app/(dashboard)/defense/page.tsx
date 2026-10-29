import Link from "next/link";
import { getDefenseIndex } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";

export const dynamic = "force-dynamic";

export const metadata = { title: "Defense — range runs" };

type Q = { season?: string; group?: string; sort?: string };

/**
 * The league range board (D-14): §81's chance model turned into fielder
 * standings — runs above an average fielder at the position, on every ball in
 * play the model prices (Savant start positions + physics hang time in the
 * difficulty fit, game-grouped folds, AUC .94-.95 per season). Savant's own
 * OAA and fielding run value sit beside ours on every row as reference
 * columns; the profile Defense tab carries the per-card, per-chance version.
 */

const COLS = [
  { key: "runs", label: "Range runs" },
  { key: "oaaOurs", label: "OAA (ours)" },
  { key: "savOaa", label: "OAA (Savant)" },
  { key: "savFrv", label: "FRV (Savant)" },
  { key: "speedScore", label: "SpdSc" },
  { key: "sprint", label: "Sprint (Sav)" },
  { key: "jumpBurst", label: "Jump burst (Sav)" },
  { key: "chances", label: "Chances" },
];

const fmt = (v: unknown, nd = 1): string =>
  typeof v === "number" && Number.isFinite(v) ? (nd === 0 ? String(Math.round(v)) : v.toFixed(nd)) : "—";

export default async function DefensePage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const index = await getDefenseIndex();
  const seasons = Object.keys(index?.seasons ?? {}).map(Number).sort((a, b) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const group = q.group === "OF" ? "OF" : q.group === "IF" ? "IF" : "ALL";
  const sortKey = COLS.find((c) => c.key === q.sort)?.key ?? "runs";
  let rows: any[] = (index?.seasons?.[String(season)] ?? []).filter((r: any) => group === "ALL" || r.group === group);
  rows = [...rows].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (typeof x !== "number" || typeof y !== "number") return 0;
    return y - x;
  });

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { season: String(season), group, sort: sortKey, ...over };
    for (const [k, v] of Object.entries(m)) if (v && v !== "ALL") p.set(k, String(v));
    return `/defense?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Defense — range runs</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Runs above an average fielder at the position, from the range model: every ball in play is priced by
        difficulty — exit velocity, launch, direction, park, alignment, the fielder&apos;s own start position and the
        ball&apos;s hang time — and credit is the play made minus its probability, valued in runs. Fit within each
        season on game-grouped folds (AUC .94–.95); catchers have their own page (Framing+). Savant&apos;s OAA and
        fielding run value sit beside ours as reference columns — ours labelled, theirs labelled. 30+ chances;
        the profile Defense tab shows each fielder&apos;s cards and the chances themselves.
        <span className="text-text-secondary">
          {" "}Known gap, measured (RESULTS-MLB §97/§100): our numbers <em>compress elite range</em> — Savant grades
          per-play positioning and routes that public data does not carry, so the best outfielders show lower here
          than there (hover a Savant OAA cell on a big gap). The ordering is the signal, not the scale.
        </span>
        <span className="text-text-secondary">
          {" "}Speed columns (D-39, descriptive): SpdSc is our Speed Score from public inputs — Savant sprint speed,
          stolen-base and extra-base runs per PA, triples per ball in play, each ranked within the season (YoY .71) —
          Sprint and Jump burst are Savant&apos;s published numbers, shown beside ours per §100.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s) => (
          <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {[["ALL", "All"], ["IF", "Infield"], ["OF", "Outfield"]].map(([k, label]) => (
          <Link key={k} href={link({ group: k })} className={chip(group === k)}>{label}</Link>
        ))}
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Fielder</th>
                <th className="px-2 py-2 text-left font-semibold">Pos</th>
                {COLS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-semibold">
                    <Link href={link({ sort: c.key })} className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 60).map((r) => (
                <tr key={`${r.id}-${r.pos}`} className="border-t border-white/[0.04]">
                  <td className="px-4 py-1.5 font-sans">
                    <Link href={`/player/${r.id}?season=${season}&tab=defense`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                  </td>
                  <td className="px-2 py-1.5 font-sans text-text-dim">{r.pos}</td>
                  {COLS.map((c) => {
                    const gap = c.key === "savOaa" && typeof r.oaaOurs === "number" && typeof r.savOaa === "number"
                      ? r.savOaa - r.oaaOurs : null;
                    const note = gap != null && Math.abs(gap) >= 8
                      ? `Differs from our ${fmt(r.oaaOurs)} by ${fmt(Math.abs(gap))} runs — the measured elite-range compression (RESULTS-MLB §97/§100): Savant grades per-play positioning and routes that public data does not carry.`
                      : undefined;
                    return (
                      <td key={c.key} title={note} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                        {fmt(r[c.key], c.key === "chances" ? 0 : 1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          <span>{rows.length.toLocaleString("en-US")} fielder-seasons · 30+ chances · top 60 shown</span>
          <span>rows link the profile Defense tab</span>
        </div>
      </div>
      <SpeedScatter rows={rows} />
    </div>
  );
}

/** D-39: Speed Score vs our OAA for the season's fielders with both — the speed-tool story at a glance. */
function SpeedScatter({ rows }: { rows: any[] }) {
  const W = 560, H = 260, PL = 40, PR = 16, PT = 14, PB = 30;
  const pts = rows.filter((r) => typeof r.speedScore === "number" && typeof r.oaaOurs === "number");
  if (pts.length < 20) return null;
  const xs = pts.map((r) => r.speedScore), ys = pts.map((r) => r.oaaOurs);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(0, ...ys), y1 = Math.max(...ys) + 1;
  const sx = (v: number) => PL + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const a = my - b * mx;
  const sdx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) / n), sdy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0) / n);
  const r = b * sdx / Math.max(1e-9, sdy); // Pearson r from the OLS slope: r = slope · sd(x) / sd(y)
  const yTick = [y0, (y0 + y1) / 2, y1];
  return (
    <div className="glass-panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Speed Score vs our OAA</h2>
        <span className="text-[10px] text-text-dim">{n} fielder-seasons · slope {b.toFixed(2)} OAA per SpdSc point · r {r.toFixed(2)} · descriptive</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[720px]" role="img" aria-label="Speed Score against our outs above average">
        <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.15)" />
        {yTick.map((v) => <text key={v} x={PL - 5} y={sy(v) + 3} textAnchor="end" fontSize={8} fill="#5d6577">{v.toFixed(0)}</text>)}
        <line x1={sx(x0)} y1={sy(a + b * x0)} x2={sx(x1)} y2={sy(a + b * x1)} stroke="rgba(227,179,65,0.7)" strokeDasharray="4 3" />
        {pts.map((p) => <circle key={`${p.id}-${p.pos}`} cx={sx(p.speedScore)} cy={sy(p.oaaOurs)} r={2.2}
          fill={p.group === "OF" ? "#e3b341" : "#7da1c4"} opacity={0.75} />)}
        <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize={8} fill="#5d6577">Speed Score (0-100, within-season percentiles: sprint · SB runs/PA · XB runs/PA · 3B/BIP) →</text>
        <text x={10} y={PT + 6} fontSize={8} fill="#5d6577">OAA (ours)</text>
      </svg>
      <p className="text-[10px] text-text-dim">gold = outfielders, blue = infielders; dashed = league trend. Speed Score is
        descriptive (RESULTS-MLB has no gate; year-to-year stickiness .71) — speed shows up in range, and the
        above-trend dots at the right edge are the range seasons our model can partially but not fully explain.</p>
    </div>
  );
}
