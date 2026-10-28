"use client";

/**
 * Run value in context (PP19, wave 4): the situations a pitcher was handed.
 * Leverage is the base-out state's run expectancy over the league average,
 * measured from the same season's data; the RV/100 rows split his pitches by
 * that leverage. Measured records, never a grade — situations are handed to a
 * pitcher, not earned — and the neutral-value half of the college panel
 * (stripping the situation out of run value) needs a model the site does not
 * have, so it is not attempted.
 */

const signed = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

function describeLeverage(pct: number | null | undefined): string {
  if (pct == null) return "";
  if (pct >= 90) return "unusually high-leverage work";
  if (pct >= 70) return "higher-leverage than most";
  if (pct <= 10) return "unusually low-leverage work";
  if (pct <= 30) return "lower-leverage than most";
  return "close to league-average situations";
}

export function SituationalRunsPanel({ data, name }: { data: any | null; name?: string }) {
  if (!data?.meta) return null;
  const gates = 200;
  if ((data.pitches ?? 0) < gates) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Run value in context</h2>
        <p className="text-[11px] text-text-secondary">
          Not published for {name || "this pitcher"} — under {gates} pitches, the sample these splits were gated on.
        </p>
      </div>
    );
  }
  const hi = data.highLeverage, lo = data.lowLeverage;
  const gap = hi?.rvPer100 != null && lo?.rvPer100 != null ? hi.rvPer100 - lo.rvPer100 : null;
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Run value in context</h2>
          <p className="text-[10px] text-text-dim">his RV/100 by the leverage he was handed</p>
        </div>
        <span className="text-[10px] text-text-dim">{data.season} · {Number(data.pitches).toLocaleString()} pitches</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-dim">High leverage</div>
          <div className="font-data text-base text-text-primary mt-0.5">{signed(hi?.rvPer100)}</div>
          <div className="text-[10px] text-text-dim">{hi?.n?.toLocaleString() ?? 0} pitches</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-dim">Low leverage</div>
          <div className="font-data text-base text-text-primary mt-0.5">{signed(lo?.rvPer100)}</div>
          <div className="text-[10px] text-text-dim">{lo?.n?.toLocaleString() ?? 0} pitches</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-dim">High − low</div>
          <div className="font-data text-base text-text-primary mt-0.5">{signed(gap)}</div>
          <div className="text-[10px] text-text-dim">the "clutch" gap, this season</div>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-text-secondary mb-2">
        {typeof data.leverageFaced === "number" && (
          <>He pitched at a mean leverage of <span className="font-data">{data.leverageFaced.toFixed(2)}</span>
            {data.leveragePct != null ? <> — {describeLeverage(data.leveragePct)} ({data.leveragePct}th percentile)</> : null}.{" "}
          </>
        )}
        {gap !== null && (
          Math.abs(gap) < 0.3
            ? <>His results barely moved with the stakes this season.</>
            : gap > 0
              ? <>His results ran better in the high-leverage spots this season.</>
              : <>His results ran worse in the high-leverage spots this season.</>
        )}
      </p>

      <p className="text-[10px] leading-relaxed text-text-dim">
        Leverage = the base-out state&apos;s run expectancy over the league average, measured from this season&apos;s
        data ({data.meta?.hiCut ? `high ≥ ${data.meta.hiCut}, low ≤ ${data.meta.loCut}` : "terciles"}). Situations are
        handed to a pitcher, not earned, so this is a record with no grade — and one season&apos;s clutch gap is mostly
        noise, so it is deliberately uncoloured.
      </p>
    </div>
  );
}
