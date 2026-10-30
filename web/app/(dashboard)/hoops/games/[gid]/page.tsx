import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { getHoopsGame } from "@/lib/data-hoops";
import { ShotChart } from "@/components/ui/shot-chart";

export const dynamic = "force-dynamic";

/**
 * The basketball game report (Phase 1, descriptive): final score, team stat
 * lines, both box scores, the x/y shot chart and the play feed — all from the
 * baked per-game file. Raw values only; the LUMA cross-check recorded in the
 * bake's meta.json is what lets these render at all.
 */
export default async function HoopsGamePage({ params }: {
  params: Promise<{ gid: string }>;
}) {
  const { gid } = await params;
  const doc = await getHoopsGame(gid);
  if (!doc || !doc.game) notFound();
  const { game, teams, boxes, shots, plays } = doc;
  const abbrs = teams.map((t) => t.abbr) as [string | null, string | null];
  const label = (a: string | null) => a ?? "?";

  const periods = [...new Set(plays.map((p) => p.p))].sort((a, b) => a - b);
  const periodName = (p: number) => (p <= 4 ? `Q${p}` : `OT${p - 4}`);
  const clock = (t: number | null) => {
    if (t == null) return "";
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-5">
      <BackLink fallback="/hoops" className="text-[11px] text-text-dim hover:text-text-secondary" />

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-text-primary tabular-nums">
          {label(game.away)} {game.away_score} @ {label(game.home)} {game.home_score}
          {game.ot ? <span className="text-text-dim text-sm"> · {game.ot}OT</span> : null}
        </h1>
        <span className="text-xs text-text-dim">{game.date} · {game.type}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 max-w-2xl">
        {teams.map((t) => (
          <Link key={t.abbr ?? t.side} href={`/hoops/teams/${(t.abbr ?? "").toLowerCase()}`}
            className="rounded-lg border border-border-subtle px-3 py-2 text-xs hover:bg-white/[0.04]">
            <div className="text-text-primary font-medium">
              {t.abbr} · {t.points} pts
              <span className="ml-2 text-[11px] text-text-dim">{t.side}</span>
            </div>
            <div className="text-text-dim mt-1 tabular-nums">
              REB {t.reb ?? "—"} · AST {t.ast ?? "—"} · TOV {t.tov ?? "—"} ·{" "}
              paint {t.paint ?? "—"} · fastbreak {t.fastbreak ?? "—"}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(boxes).map(([abbr, rows]) => (
          <div key={abbr} className="space-y-1">
            <h2 className="text-sm font-medium text-text-primary">{abbr}</h2>
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-text-dim text-left">
                  <th className="font-normal pr-2">Player</th>
                  <th className="font-normal">MIN</th><th className="font-normal">PTS</th>
                  <th className="font-normal">REB</th><th className="font-normal">AST</th>
                  <th className="font-normal">STL</th><th className="font-normal">BLK</th>
                  <th className="font-normal">TO</th><th className="font-normal">PF</th>
                  <th className="font-normal">FG</th><th className="font-normal">3PT</th>
                  <th className="font-normal">FT</th><th className="font-normal">+/-</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => !r.dnp).map((r) => (
                  <tr key={r.name} className="border-t border-border-subtle/50">
                    <td className="pr-2 text-text-primary">
                      {r.starter ? <span className="text-usf-gold mr-0.5">●</span> : null}
                      {r.name}
                      {r.pos ? <span className="text-text-dim"> · {r.pos}</span> : null}
                    </td>
                    <td>{r.min ?? "—"}</td><td className="font-medium">{r.pts ?? "—"}</td>
                    <td>{r.reb ?? "—"}</td><td>{r.ast ?? "—"}</td>
                    <td>{r.stl ?? "—"}</td><td>{r.blk ?? "—"}</td>
                    <td>{r.tov ?? "—"}</td><td>{r.pf ?? "—"}</td>
                    <td>{r.fg ?? "—"}</td><td>{r.tp ?? "—"}</td><td>{r.ft ?? "—"}</td>
                    <td className={r.pm != null && r.pm > 0 ? "text-usf-green" : r.pm != null && r.pm < 0 ? "text-[#e0654f]" : ""}>
                      {r.pm ?? "—"}</td>
                  </tr>
                ))}
                {rows.filter((r) => r.dnp).length ? (
                  <tr className="border-t border-border-subtle/50">
                    <td colSpan={13} className="text-text-dim pt-1">
                      DNP: {rows.filter((r) => r.dnp).map((r) => r.name).join(", ")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="space-y-2 max-w-2xl">
        <h2 className="text-sm font-medium text-text-primary">Shot chart</h2>
        <ShotChart shots={shots} home={abbrs.find((a) => a === game.home) ?? null}
                   away={abbrs.find((a) => a === game.away) ?? null} />
        <p className="text-[11px] text-text-dim">
          Coordinates are ESPN&apos;s, normalized to the attacking half by the bake
          (feet; baseline at the top). Free throws are excluded from the chart.
        </p>
      </div>

      <div className="space-y-3 max-w-2xl">
        <h2 className="text-sm font-medium text-text-primary">Play by play</h2>
        {periods.map((p) => (
          <div key={p}>
            <div className="text-[11px] font-medium text-text-dim uppercase tracking-wide mb-1">{periodName(p)}</div>
            <div className="space-y-0.5">
              {plays.filter((pl) => pl.p === p).map((pl, i) => (
                <div key={i} className="flex gap-2 text-[11px] leading-snug">
                  <span className="text-text-dim tabular-nums w-9 shrink-0 text-right">{clock(pl.t)}</span>
                  <span className="w-9 shrink-0 text-text-dim">{pl.a ?? ""}</span>
                  <span className="flex-1 text-text-secondary">{pl.tx}</span>
                  <span className="tabular-nums text-text-dim w-14 shrink-0 text-right">{pl.hs}–{pl.as}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
