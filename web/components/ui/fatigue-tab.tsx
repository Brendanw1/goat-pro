"use client";

/**
 * The Fatigue tab (depth list item 3): how a pitcher's stuff and outcomes
 * hold up as the game goes on — by times through the order, by rest days,
 * and velo by pitch number within a start. All measured, no model grades;
 * the league row is the same season's aggregate, so the third-time-through
 * penalty reads against what the whole league loses.
 *
 * Drops are 1st-time minus 3rd-time (positive = a decline by the third look)
 * and need 30+ PA in both; the FF fade needs 30 four-seamers in both the
 * 1st-15 and 76th-90th pitch buckets. Everything below those floors shows
 * as "—" rather than noise.
 */

const TTO_LABEL: Record<string, string> = {
  "1": "1st time through",
  "2": "2nd time through",
  "3": "3rd time through",
  "4": "4th+ time through",
};
const REST_LABEL: Record<string, string> = {
  "0-3": "0–3 days rest", "4": "4 days", "5": "5 days", "6": "6 days", "7+": "7+ days",
};

function Cell({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="px-3 py-2 border-r border-b border-white/[0.04] last:border-r-0">
      <div className="text-[9px] uppercase tracking-wider text-text-dim">{label}</div>
      <div className="text-sm font-data text-text-primary mt-0.5">{value}</div>
      {sub ? <div className="text-[9px] text-text-dim mt-0.5 leading-tight">{sub}</div> : null}
    </div>
  );
}

function fmt(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

/** FF velo by pitch-number bucket as a stepped line with the fade annotated. */
function FadeChart({ fade, fade75 }: { fade: any[]; fade75: number | null | undefined }) {
  const pts = fade.filter((x) => x.ffVelo != null);
  if (pts.length < 3) return null;
  const W = 460, H = 150, PL = 30, PR = 10, PT = 16, PB = 18;
  const vals = pts.map((x) => x.ffVelo as number);
  const lo = Math.min(...vals) - 0.6, hi = Math.max(...vals) + 0.6;
  const px = (i: number) => PL + (i / (pts.length - 1)) * (W - PL - PR);
  const py = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const path = pts.map((x, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(x.ffVelo).toFixed(1)}`).join("");
  const dotR = pts.map((x) => Math.max(1.6, Math.min(4.5, Math.sqrt(x.nFf / 24))));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="fastball velocity by pitch number">
        <path d={path} fill="none" stroke="#e3b341" strokeWidth={1.8} />
        {pts.map((x, i) => (
          <circle key={x.bucket} cx={px(i)} cy={py(x.ffVelo)} r={dotR[i]} fill="#e3b341" opacity={0.85} />
        ))}
        {pts.map((x, i) => (
          <text key={x.bucket} x={px(i)} y={H - 5} textAnchor="middle" fontSize={8.5} fill="#8b93a7">{x.bucket}</text>
        ))}
        <text x={W - PR} y={12} textAnchor="end" fontSize={9.5} fill="#e3b341">
          {fade75 != null ? `−${fade75.toFixed(1)} mph by pitch 76–90` : "FF velo"}
        </text>
      </svg>
      <div className="text-[9px] text-text-dim text-center -mt-1">
        four-seam velocity by pitch number within the start — dot size is fastballs thrown
      </div>
    </div>
  );
}

export function FatigueTab({ load, levelLabel }: { load: any | null; levelLabel?: string }) {
  if (!load?.tto) {
    return (
      <div className="glass-panel p-6 text-center text-xs text-text-dim">
        No fatigue profile for this season — it needs 400+ pitches at this level.
      </div>
    );
  }
  const s = load.summary ?? {};
  const ttoKeys = Object.keys(load.tto);
  const restKeys = Object.keys(load.rest ?? {});
  const hasLeague = ttoKeys.some((k) => load.league?.[k]?.velo != null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-dim">
          Fatigue — times through, rest, and the velo fade
        </h3>
        <span className="text-[10px] text-text-dim">
          {load.nPitches?.toLocaleString()} pitches · {load.nGames} games · {load.season}
          {levelLabel ? ` · ${levelLabel}` : ""}
        </span>
      </div>

      <div className="glass-panel grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 -mb-px">
        <Cell label="Velo T1 → T3" value={`${fmt(s.veloT1)} → ${fmt(s.veloT3)}`}
          sub={s.veloDropTto != null ? `${s.veloDropTto > 0 ? "loses" : "gains"} ${Math.abs(s.veloDropTto).toFixed(1)} mph by the third look` : "needs 30+ PA both times"} />
        <Cell label="Whiff% T1 → T3" value={`${fmt(s.whiffT1)}% → ${fmt(s.whiffT3)}%`}
          sub={s.whiffDropTto != null ? `${s.whiffDropTto > 0 ? "−" : "+"}${Math.abs(s.whiffDropTto).toFixed(1)} pts` : null} />
        <Cell label="K% T1 → T3" value={`${fmt(s.kT1)}% → ${fmt(s.kT3)}%`}
          sub={s.kDropTto != null ? `${s.kDropTto > 0 ? "−" : "+"}${Math.abs(s.kDropTto).toFixed(1)} pts` : null} />
        <Cell label="FF fade by pitch 75" value={s.ffFade75 != null ? `−${s.ffFade75.toFixed(1)} mph` : "—"}
          sub="four-seam at pitches 76–90 vs 1–15" />
      </div>

      <div className="glass-panel p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">By times through the order</div>
        <table className="w-full text-xs font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="py-1 text-left font-semibold">Look</th>
              <th className="py-1 text-right font-semibold">PA</th>
              <th className="py-1 text-right font-semibold">Velo</th>
              <th className="py-1 text-right font-semibold">Whiff%</th>
              <th className="py-1 text-right font-semibold">K%</th>
              <th className="py-1 text-right font-semibold">BB%</th>
              <th className="py-1 text-right font-semibold">EV</th>
              <th className="py-1 text-right font-semibold">Runs/100</th>
            </tr>
          </thead>
          <tbody>
            {ttoKeys.map((k) => {
              const c = load.tto[k];
              return (
                <tr key={k} className="border-t border-white/[0.04]">
                  <td className="py-1 font-sans text-text-secondary">{TTO_LABEL[k] ?? k}</td>
                  <td className="py-1 text-right text-text-dim">{c.pa}</td>
                  <td className="py-1 text-right text-text-secondary">{fmt(c.velo)}</td>
                  <td className="py-1 text-right text-text-secondary">{fmt(c.whiffPct)}</td>
                  <td className="py-1 text-right text-text-secondary">{fmt(c.kPct)}</td>
                  <td className="py-1 text-right text-text-secondary">{fmt(c.bbPct)}</td>
                  <td className="py-1 text-right text-text-secondary">{fmt(c.ev)}</td>
                  <td className="py-1 text-right text-text-secondary">{fmt(c.runsPer100)}</td>
                </tr>
              );
            })}
            {hasLeague && (
              <tr className="border-t border-border-subtle text-text-dim">
                <td className="py-1 font-sans">League, {load.season}</td>
                <td className="py-1 text-right">—</td>
                <td className="py-1 text-right">{fmt(load.league?.["1"]?.velo)} → {fmt(load.league?.["3"]?.velo)}</td>
                <td className="py-1 text-right">{fmt(load.league?.["1"]?.whiffPct)} → {fmt(load.league?.["3"]?.whiffPct)}</td>
                <td className="py-1 text-right">{fmt(load.league?.["1"]?.kPct)} → {fmt(load.league?.["3"]?.kPct)}</td>
                <td className="py-1 text-right">{fmt(load.league?.["1"]?.bbPct)} → {fmt(load.league?.["3"]?.bbPct)}</td>
                <td className="py-1 text-right">—</td>
                <td className="py-1 text-right">{fmt(load.league?.["1"]?.runsPer100)} → {fmt(load.league?.["3"]?.runsPer100)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="glass-panel p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">By rest days before the outing</div>
          <table className="w-full text-xs font-data">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-text-dim">
                <th className="py-1 text-left font-semibold">Rest</th>
                <th className="py-1 text-right font-semibold">Outings</th>
                <th className="py-1 text-right font-semibold">Velo</th>
                <th className="py-1 text-right font-semibold">Whiff%</th>
                <th className="py-1 text-right font-semibold">Runs/100</th>
              </tr>
            </thead>
            <tbody>
              {restKeys.map((k) => {
                const c = load.rest[k];
                return (
                  <tr key={k} className="border-t border-white/[0.04]">
                    <td className="py-1 font-sans text-text-secondary">{REST_LABEL[k] ?? k}</td>
                    <td className="py-1 text-right text-text-dim">{c.outings}</td>
                    <td className="py-1 text-right text-text-secondary">{fmt(c.velo)}</td>
                    <td className="py-1 text-right text-text-secondary">{fmt(c.whiffPct)}</td>
                    <td className="py-1 text-right text-text-secondary">{fmt(c.runsPer100)}</td>
                  </tr>
                );
              })}
              {!restKeys.length && (
                <tr><td colSpan={5} className="py-2 text-text-dim">No rest-day splits this season.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="glass-panel p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Velo by pitch number within the start</div>
          <FadeChart fade={load.fade ?? []} fade75={s.ffFade75} />
        </div>
      </div>

      <p className="text-[10px] text-text-dim leading-relaxed max-w-[95ch]">
        Measured from every pitch of the season: the TTO column is the pitcher&apos;s ordinal look at each lineup spot
        that game (the 4th and later looks fold together), rest is days since his previous game, and the fade curve
        is four-seam velocity only. Runs/100 is Statcast run value per 100 pitches, positive good for the pitcher.
        Descriptive — the third-time penalty mixes fatigue with the hitter&apos;s own adjustments, which is exactly
        why the league row sits underneath. Drops need 30+ PA in both looks, the fade 30+ fastballs in both buckets.
      </p>
    </div>
  );
}
