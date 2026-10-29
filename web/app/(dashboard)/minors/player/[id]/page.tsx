import { getPlayerProfile, getHitterProfile, getMinorsIndex, getMinorsLines } from "@/lib/data";
import { PlayerPage } from "../../../player/[id]/player-page";
import { CareerByLevel } from "@/components/ui/career-by-level";
import { MlePanel } from "@/components/ui/mle-panel";
import { PlayerReady } from "@/components/ui/player-transition";
import { TransactionsPanel } from "@/components/ui/transactions-panel";
import { getTransactions } from "@/lib/data";
import Link from "next/link";

/** A minor leaguer: the AAA Statcast profile when he has one, else his line by level alone. */
async function latestLine(id: string) {
  const index = await getMinorsIndex();
  for (const kind of ["pitchers", "hitters"] as const) {
    for (const s of [...(index?.[kind] ?? [])].reverse()) {
      const row = (await getMinorsLines(kind, s))?.rows?.find((r: any) => r.id === id);
      if (row) return { ...row, season: s, kind };
    }
  }
  return null;
}

export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const season = (await searchParams)?.season;
  const p = (await getPlayerProfile(id, season, "aaa")) ?? (await getHitterProfile(id, season, "aaa")) ?? (await latestLine(id));
  return { title: p?.name ? `${p.name} (Minors)` : "Player Not Found" };
}

export default async function MinorsPlayerPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const season = (await searchParams)?.season;
  const aaa = (await getPlayerProfile(id, season, "aaa")) ?? (await getHitterProfile(id, season, "aaa"));
  const tx = (aaa || (await latestLine(id))) ? await getTransactions(id) : null;
  const back = (
    <Link href="/minors" className="px-3 py-1 rounded-lg text-xs bg-white/[0.05] border border-border-subtle text-text-secondary hover:bg-white/[0.08] transition-all">
      ← Minors
    </Link>
  );
  if (aaa) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-white/[0.06] text-text-secondary">
            AAA · Statcast
          </span>
        </div>
        <PlayerPage id={id} season={season} level="aaa"
          extra={<><MlePanel id={id} /><CareerByLevel id={id} /><TransactionsPanel tx={tx} /></>} />
      </div>
    );
  }
  const line = await latestLine(id);
  // D-30-flavoured context (wave: depth pass): the line-only page answers the
  // first question a scout asks — how old is he for the level, and how does
  // his line sit against everyone else playing at that level this season.
  let ctx: { medAge: number; medK: number; medBB: number; medOps: number | null; n: number } | null = null;
  if (line) {
    const rows = ((await getMinorsLines(line.kind as "pitchers" | "hitters", line.season))?.rows ?? [])
      .filter((r: any) => r.level === line.level && r.age != null);
    const med = (xs: number[]) => {
      const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : NaN;
    };
    if (rows.length >= 30) {
      ctx = {
        medAge: med(rows.map((r: any) => r.age)),
        medK: med(rows.map((r: any) => r.kPct)),
        medBB: med(rows.map((r: any) => r.bbPct)),
        medOps: line.kind === "hitters" ? med(rows.map((r: any) => r.ops)) : null,
        n: rows.length,
      };
    }
  }
  const ctxRow = (label: string, mine: number | null | undefined, med: number | null | undefined, fmt2: (x: number) => string, lowerBetter = false) => {
    if (mine == null || med == null || !Number.isFinite(mine) || !Number.isFinite(med)) return null;
    const d = mine - med;
    const good = (d > 0) !== lowerBetter && Math.abs(d) > 0.001;
    return (
      <div className="flex items-baseline justify-between gap-2 py-1 border-b border-white/[0.03]" key={label}>
        <span className="text-[11px] text-text-secondary">{label}</span>
        <span className="text-right font-data text-[11px]">
          <span className="text-text-primary">{fmt2(mine)}</span>
          <span className="text-text-dim"> vs {fmt2(med)} lg</span>{" "}
          <span style={{ color: good ? "#5ba88f" : "#e0654f" }}>
            {d > 0 ? "+" : "−"}{fmt2(Math.abs(d)).replace(/^0/, "")}
          </span>
        </span>
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <PlayerReady />
      {back}
      {line ? (
        <div className="glass-panel p-4">
          <h1 className="text-xl font-semibold text-text-primary">{line.name}</h1>
          <p className="text-[11px] text-text-dim mt-0.5">
            {line.team} · {line.level === "ROK" ? "Rookie" : line.level} · {line.season}
            {line.kind === "pitchers" ? ` · throws ${line.throws ?? "—"}` : ` · ${line.pos ?? ""} · bats ${line.bats ?? "—"}`}
          </p>
        </div>
      ) : (
        <div className="glass-panel p-8 text-center text-sm text-text-dim">Player not found</div>
      )}
      {line && ctx && (
        <div className="glass-panel p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
            In context · {line.level === "ROK" ? "Rookie" : line.level}, {line.season}
          </h2>
          {ctxRow("Age", line.age != null ? Number(line.age) : null, ctx.medAge, (x) => x.toFixed(1))}
          {line.kind === "pitchers" ? (
            <>
              {ctxRow("K%", line.kPct, ctx.medK, (x) => `${x.toFixed(1)}%`)}
              {ctxRow("BB%", line.bbPct, ctx.medBB, (x) => `${x.toFixed(1)}%`, true)}
            </>
          ) : (
            <>
              {ctxRow("OPS", line.ops, ctx.medOps, (x) => x.toFixed(3).replace(/^0/, "."))}
              {ctxRow("K%", line.kPct, ctx.medK, (x) => `${x.toFixed(1)}%`, true)}
              {ctxRow("BB%", line.bbPct, ctx.medBB, (x) => `${x.toFixed(1)}%`)}
            </>
          )}
          <p className="mt-2 text-[10px] text-text-dim leading-[1.5]">
            Median of the {ctx.n} players at this level this season. Age is the scouting half of the read
            {line.age != null && Number.isFinite(ctx.medAge) ? (
              <>: at {Number(line.age).toFixed(1)}, he is {Math.abs(Number(line.age) - ctx.medAge) < 0.25
                ? "right at the level&apos;s median age"
                : `${(Math.abs(Number(line.age) - ctx.medAge)).toFixed(1)} years ${Number(line.age) < ctx.medAge ? "younger" : "older"} than the level&apos;s median (${ctx.medAge.toFixed(1)})`}</>
            ) : ""} — production reads differently at each.
          </p>
        </div>
      )}
      <MlePanel id={id} />
      <CareerByLevel id={id} />
      <TransactionsPanel tx={tx} />
    </div>
  );
}
