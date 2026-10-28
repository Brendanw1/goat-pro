import Link from "next/link";

/**
 * The ticker strip (R6) at the top of /pitchers: the latest day's best lines
 * and the season's biggest Whiff+ movers, from the bake's ticker.json.
 * Measured lines for the starts/hitting; the movers are a descriptive model
 * change and say so. Server-rendered; absent quietly when the file is stale
 * or missing.
 */

const Empty = null;

export function TickerStrip({ ticker }: { ticker: any | null }) {
  if (!ticker?.date) return Empty;
  const starts = (ticker.starts ?? []).slice(0, 4);
  const hitting = (ticker.hitting ?? []).slice(0, 4);
  const up = (ticker.moversUp ?? []).slice(0, 3);
  const down = (ticker.moversDown ?? []).slice(0, 3);
  return (
    <div className="glass-panel px-4 py-3 animate-fade-up">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">The latest</h2>
        <span className="text-[10px] text-text-dim font-data">{ticker.date}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3 text-[11px]">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-dim mb-1">Top starts</p>
          <ul className="space-y-1">
            {starts.map((s: any) => (
              <li key={`${s.id}-${s.season}`} className="flex items-baseline justify-between gap-2">
                <Link href={`/player/${s.id}?season=${s.season}`} className="text-text-primary hover:underline truncate">
                  {s.n ?? s.id}
                </Link>
                <span className="font-data text-text-secondary whitespace-nowrap">
                  {s.ip} IP · {s.k} K · {s.r} R
                </span>
              </li>
            ))}
            {!starts.length && <li className="text-text-dim">No games.</li>}
          </ul>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-dim mb-1">Big lines</p>
          <ul className="space-y-1">
            {hitting.map((h: any) => (
              <li key={`${h.id}-${h.season}`} className="flex items-baseline justify-between gap-2">
                <Link href={`/player/${h.id}?season=${h.season}`} className="text-text-primary hover:underline truncate">
                  {h.n ?? h.id}
                </Link>
                <span className="font-data text-text-secondary whitespace-nowrap">
                  {h.hr > 0 ? `${h.hr} HR · ` : ""}{h.h}-for-{h.pa}
                </span>
              </li>
            ))}
            {!hitting.length && <li className="text-text-dim">No games.</li>}
          </ul>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-dim mb-1">Whiff+ movers, season over season</p>
          <ul className="space-y-1">
            {[...up, ...down].slice(0, 5).map((m: any) => (
              <li key={m.id} className="flex items-baseline justify-between gap-2">
                <Link href={`/player/${m.id}`} className="text-text-primary hover:underline truncate">
                  {m.n ?? m.id}
                </Link>
                <span className="font-data whitespace-nowrap" style={{ color: m.delta > 0 ? "#5ba88f" : "#e0654f" }}>
                  {m.from} → {m.to} ({m.delta > 0 ? "+" : ""}{m.delta})
                </span>
              </li>
            ))}
            {!up.length && !down.length && <li className="text-text-dim">Needs two graded seasons.</li>}
          </ul>
          <p className="text-[9px] text-text-dim mt-1.5">Descriptive model change, not a forecast.</p>
        </div>
      </div>
    </div>
  );
}
