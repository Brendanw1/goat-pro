"use client";

/**
 * Batted ball, by what was thrown (D-27 port of the college batted-ball panel).
 * Rows aggregate the same per-ball spray file the chart reads: one row per pitch
 * type plus the overall line, with an Overall / vs RHP / vs LHP platoon toggle
 * (the pitcher's hand rides each ball). Trajectory comes from launch angle, not
 * the stringer's tag — among balls tracking puts at 25-50° the FlyBall tag fell
 * for a hit 23.8% of the time against 62.0% for LineDrive, so the tag describes
 * the result, not the ball (college finding, carried here). xBA and xwOBACON are
 * Savant's own per-ball EV/LA estimates averaged over the row — attributed, not
 * modelled by us. Under five on its own denominator a share prints as its
 * fraction — 1/3, not 33.3 — because that is exactly what the sample says.
 */
import { useMemo, useState } from "react";
import { PITCH_CONFIG } from "@/lib/constants";

interface Ball {
  ev?: number | null; la?: number | null; x?: number | null; y?: number | null;
  e?: string | null; t?: string | null; s?: "L" | "R"; pt?: string | null; ph?: string | null;
  ba?: number | null; w?: number | null;
}

const HITS = new Set(["single", "double", "triple", "home_run"]);
const SITE_ORDER = ["FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS"];
/** Launch-angle trajectory (college rule): GB <10, LD 10-25, FB 25-50, PU >=50; Air = LD+FB+PU. */
const trajOf = (la: number): "gb" | "ld" | "fb" | "pu" | null =>
  la < 10 ? "gb" : la < 25 ? "ld" : la < 50 ? "fb" : "pu";

interface Acc {
  p: number; bip: number;
  traj: Record<string, number>; laN: number;
  dir: Record<string, number>; dirN: number;
  ev: { s: number; n: number }; laSum: { s: number; n: number };
  ba: { s: number; n: number }; w: { s: number; n: number };
}
const blank = (): Acc => ({ p: 0, bip: 0, traj: { gb: 0, ld: 0, fb: 0, pu: 0, air: 0 }, laN: 0,
  dir: { pull: 0, str8: 0, oppo: 0 }, dirN: 0,
  ev: { s: 0, n: 0 }, laSum: { s: 0, n: 0 }, ba: { s: 0, n: 0 }, w: { s: 0, n: 0 } });

const mean = (c: { s: number; n: number }, dp: number, scale = 1): string => {
  if (c.n === 0) return "—";
  const v = c.s / c.n * scale;
  return dp === 3 ? v.toFixed(3).replace(/^0/, "") : v.toFixed(dp);
};

/** Per-cell hover: what the number was computed over. */
const over = (m: number, what: string) => `over ${m} ${what}`;

export function BattedBallTable({ data, bats }: { data: any | null; bats?: string | null }) {
  const [platoon, setPlatoon] = useState<"all" | "L" | "R">("all"); // pitcher hand
  const balls: Ball[] = useMemo(() => {
    const raw: Ball[] = data?.balls ?? [];
    return raw.filter((b) => typeof b.x === "number" && typeof b.y === "number" && (b.x !== 0 || b.y !== 0));
  }, [data]);
  const hands = new Set(balls.map((b) => b.ph).filter(Boolean));
  const types = useMemo(() => {
    const present = new Set(balls.map((b) => b.pt ?? (b.pt === null ? "other" : null)).filter((t): t is string => !!t));
    return [...SITE_ORDER.filter((t) => present.has(t)), ...(present.has("other") ? ["other"] : [])];
  }, [balls]);

  const rows = useMemo(() => {
    const filtered = balls.filter((b) => platoon === "all" || b.ph === platoon);
    const byKey: Record<string, Acc> = { all: blank() };
    for (const b of filtered) {
      const key = b.pt ?? "other";
      (byKey[key] ??= blank());
      (byKey[key] as Acc).p += 1;
      const A = byKey.all as Acc; A.p += 1;
      // trajectory from launch angle
      if (typeof b.la === "number") {
        const tr = trajOf(b.la);
        for (const k of [key, "all"] as const) {
          const a = byKey[k] as Acc;
          if (tr) { a.traj[tr] += 1; a.traj.air += (tr !== "gb" ? 1 : 0); }
          a.laN += 1;
          a.laSum.s += b.la; a.laSum.n += 1;
          if (typeof b.ev === "number") { a.ev.s += b.ev; a.ev.n += 1; }
          if (b.ba != null) { a.ba.s += b.ba; a.ba.n += 1; }
          if (b.w != null) { a.w.s += b.w; a.w.n += 1; }
        }
      }
      // direction: thirds of fair territory, from the side he batted on this ball
      const s = b.s ?? (bats === "L" || bats === "R" ? bats : null);
      if (s && typeof b.x === "number" && typeof b.y === "number") {
        const ang = (Math.atan2(b.x, b.y) * 180) / Math.PI;
        if (Math.abs(ang) <= 45) {
          const pull = s === "L" ? ang : -ang; // + = his pull side
          const dir = pull > 15 ? "pull" : pull < -15 ? "oppo" : "str8";
          for (const k of [key, "all"] as const) {
            const a = byKey[k] as Acc;
            a.dir[dir] += 1; a.dirN += 1;
          }
        }
      }
      for (const k of [key, "all"] as const) (byKey[k] as Acc).bip += 1;
    }
    const order = ["all", ...types];
    return order.filter((k) => byKey[k] && (k === "all" || byKey[k].p >= 3)).map((k) => ({ k, a: byKey[k] }));
  }, [balls, bats, platoon, types]);

  if (!balls.length) return null;

  const GROUPS: [string, number][] = [["", 1], ["Sample", 2], ["Trajectory", 5], ["Direction", 3], ["Contact", 4]];
  const COLS: { l: string; w: number; get: (a: Acc) => [string, string] }[] = [
    { l: "P", w: 46, get: (a) => [String(a.p), over(a.p, "pitches")] },
    { l: "BIP", w: 42, get: (a) => [String(a.bip), over(a.bip, "balls in play")] },
    { l: "GB%", w: 38, get: (a) => pctCell(a.traj.gb, a.laN) },
    { l: "LD%", w: 38, get: (a) => pctCell(a.traj.ld, a.laN) },
    { l: "FB%", w: 38, get: (a) => pctCell(a.traj.fb, a.laN) },
    { l: "PU%", w: 38, get: (a) => pctCell(a.traj.pu, a.laN) },
    { l: "Air%", w: 38, get: (a) => pctCell(a.traj.air, a.laN) },
    { l: "Pull%", w: 42, get: (a) => pctCell(a.dir.pull, a.dirN) },
    { l: "Str8%", w: 42, get: (a) => pctCell(a.dir.str8, a.dirN) },
    { l: "Oppo%", w: 42, get: (a) => pctCell(a.dir.oppo, a.dirN) },
    { l: "EV", w: 42, get: (a) => [mean(a.ev, 1), over(a.ev.n, "tracked balls")] },
    { l: "LA", w: 36, get: (a) => [a.laSum.n ? String(Math.round(a.laSum.s / a.laSum.n)) : "—", over(a.laSum.n, "tracked balls")] },
    { l: "xBA", w: 62, get: (a) => [mean(a.ba, 3, 0.001), over(a.ba.n, "Savant-estimated balls")] },
    { l: "xwOBACON", w: 78, get: (a) => [mean(a.w, 3, 0.001), over(a.w.n, "Savant-estimated balls")] },
  ];
  function pctCell(n: number, m: number): [string, string] {
    if (m < 5) return [m === 0 ? "—" : `${n}/${m}`, over(m, "readable balls")];
    return [`${Math.round((100 * n) / m)}`, over(m, "readable balls")];
  }

  const chip = (on: boolean) =>
    `rounded-md border px-2 py-0.5 ${on ? "border-usf-green/30 bg-usf-green/20 text-usf-gold" : "border-border-subtle text-text-secondary"}`;

  return (
    <div className="glass-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border-subtle">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Batted ball, by what was thrown</span>
        <div className="flex items-center gap-3">
          {hands.size > 1 && (
            <div className="flex gap-1 text-[10px]" role="group" aria-label="Pitcher hand">
              {([["all", "Overall"], ["R", "vs RHP"], ["L", "vs LHP"]] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={platoon === k} onClick={() => setPlatoon(k)} className={chip(platoon === k)}>{l}</button>
              ))}
            </div>
          )}
          <span className="text-[10px] text-text-dim">under 5 in a denominator: the count, not a rate</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              {GROUPS.map(([g, span], i) => (
                <th key={i} colSpan={span} className="px-1 pb-1 text-[10px] font-normal uppercase tracking-wider text-text-dim text-left">
                  {g}
                </th>
              ))}
            </tr>
            <tr>
              <th className="w-[76px] px-1 pb-1 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                <span className="sr-only">Pitch type</span>
              </th>
              {COLS.map((c) => (
                <th key={c.l} style={{ width: c.w }} className="px-1 pb-1 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim text-right">{c.l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ k, a }) => {
              const cfg = PITCH_CONFIG[k as keyof typeof PITCH_CONFIG];
              const label = k === "all" ? "All" : cfg?.label ?? "Other";
              return (
                <tr key={k} className="hover:bg-white/[0.04] transition-colors">
                  <th scope="row" className="px-1 py-1.5 text-xs font-normal text-text-primary text-left">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-[3px] h-[14px] rounded-full" style={{ backgroundColor: cfg?.color ?? "#8b93a3" }} />
                      {label}
                    </span>
                  </th>
                  {COLS.map((c) => {
                    const [v, title] = c.get(a);
                    const thin = v.includes("/") || v === "—";
                    return (
                      <td key={c.l} title={title}
                        className={`px-1 py-1.5 text-right text-xs font-data tabular-nums border-b border-white/[0.025] ${thin ? "text-text-dim" : "text-text-secondary"}`}>
                        {v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[10px] leading-relaxed text-text-dim">
        Trajectory from launch angle (GB &lt;10°, LD 10–25°, FB 25–50°, PU 50°+), not the stringer&apos;s tag.
        Direction is thirds of fair territory from the side he batted on each ball. EV and LA are means over
        tracked balls; <span className="text-text-secondary">xBA and xwOBACON are Savant&apos;s own per-ball
        estimates (exit velo + launch angle) averaged over the row — their model, attributed</span>. Platoon
        rows under 50 balls are leans. Pitcher-hand rows need the hand recorded on the ball; AAA files do not
        carry it yet.
      </p>
    </div>
  );
}
