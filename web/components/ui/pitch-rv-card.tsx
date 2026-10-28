"use client";

/**
 * Run value by pitch (PP9, measured half only). The college card's xRV/100,
 * location and xwOBA columns are NEEDS-MODEL and stripped — what ships is the
 * record: RV/100 per pitch type with an 80% range built from the league's
 * per-pitch run-value spread at that type. Results are records, not grades:
 * plain text, never coloured (the fork's gate rule for measured outcomes).
 */

interface RvRow {
  type: string;
  n: number;
  nPa: number;
  rv100: number | null;
  lo: number | null;
  hi: number | null;
  xrv100?: number | null;
}

const signed = (v: number | null | undefined, dp = 2): string =>
  v === null || v === undefined || !Number.isFinite(v as number)
    ? "—"
    : `${(v as number) > 0 ? "+" : ""}${(v as number).toFixed(dp)}`;

export function PitchRvCard({ data, season }: { data: any | null; season?: number }) {
  // The card bakes for the latest season; a season-specific profile that does
  // not match it renders nothing rather than the wrong year's numbers.
  if (!data || (season !== undefined && data.season !== season)) return null;
  const hide = data.floors?.rv?.hide ?? 50;
  const rows: RvRow[] = (data.rows || []).filter((r: RvRow) => r.n >= hide);
  if (!rows.length) return null;
  const hasX = rows.some((r) => r.xrv100 != null);
  const ranked = [...rows].filter((r) => typeof r.rv100 === "number").sort((a, b) => (b.rv100 ?? 0) - (a.rv100 ?? 0));
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Run value by pitch</span>
        <span className="text-[10px] text-text-dim">{data.season} · measured</span>
      </div>
      <div className="overflow-x-auto"><div className="min-w-max">
        <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
          <div className="w-[60px]">Pitch</div>
          <div className="w-[64px] text-right">Pitches</div>
          <div className="w-[64px] text-right">PA reach</div>
          <div className="w-[72px] text-right border-l border-border-subtle" title="What happened, per 100 pitches. Results, not skill — never coloured.">RV/100</div>
          <div className="w-[64px] text-right" title="League average RV/100 for this pitch type, same season">Lg avg</div>
          {hasX && <div className="w-[72px] text-right border-l border-border-subtle" title="Expected RV/100 from what the pitch was and where it went (RESULTS-MLB §71). Descriptive, not a forecast.">xRV/100</div>}
        </div>
        {rows.map((r) => {
          const mu = data.league?.[r.type]?.mu;
          return (
            <div key={r.type} className="flex items-center px-4 border-b border-white/[0.025]"
              style={{ height: "36px" }}
              title={r.lo !== null && r.hi !== null
                ? `80% range ${signed(r.lo)} to ${signed(r.hi)} on ${r.n.toLocaleString()} pitches${mu !== undefined ? `; league average ${signed(mu)}` : ""}`
                : undefined}>
              <div className="w-[60px] text-xs font-medium text-text-primary">{r.type}</div>
              <div className="w-[64px] text-right text-xs font-data text-text-secondary">{r.n.toLocaleString()}</div>
              <div className="w-[64px] text-right text-xs font-data text-text-dim">{r.nPa.toLocaleString()}</div>
              <div className="w-[72px] text-right text-xs font-data text-text-secondary border-l border-border-subtle">{signed(r.rv100)}</div>
              <div className="w-[64px] text-right text-xs font-data text-text-dim">{signed(mu)}</div>
              {hasX && <div className="w-[72px] text-right text-xs font-data text-text-secondary border-l border-border-subtle">{signed(r.xrv100)}</div>}
            </div>
          );
        })}
      </div></div>
      {best && (
        <p className="px-4 py-2.5 text-xs leading-relaxed text-text-secondary border-t border-border-subtle" aria-label="What this card says">
          {worst
            ? <>Read: the <strong className="text-text-primary">{best.type}</strong> has been his most valuable pitch this season at <span className="font-data">{signed(best.rv100)}</span> per 100, the <strong className="text-text-primary">{worst.type}</strong> the least at <span className="font-data">{signed(worst.rv100)}</span>.</>
            : <>Read: the <strong className="text-text-primary">{best.type}</strong> has been worth <span className="font-data">{signed(best.rv100)}</span> per 100 this season.</>}
          {" "}That ordering is the record of one season — pair it with the Whiff+ column above, which is the part more likely to repeat.
        </p>
      )}
      <p className="px-4 py-2.5 text-[10px] leading-relaxed text-text-dim border-t border-border-subtle">
        RV/100 is pitcher-positive (runs saved per 100 pitches). These are results: on a sample this size most of the
        gap between pitchers is the bounce of the ball, so the column never colours and never ranks a grade.
        {hasX && " xRV/100 prices each pitch by its shape, location and count instead of its result: stable year to year, but not a better forecast than RV/100 itself (RESULTS-MLB §71), so it is descriptive too."}
      </p>
    </div>
  );
}
