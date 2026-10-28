import Link from "next/link";

/**
 * Season switcher for a player profile (wave 8): one chip per season he has
 * at this level, from the career file, linking the same page with ?season=.
 * The current season is filled; others are links. Server-rendered — no state,
 * no client code, so it paints with the page.
 *
 * Headlines under each chip give the chip row its read: IP or PA per season,
 * so switching is a choice between line items, not dates.
 */

export function SeasonSelector({ id, seasons, current, level }: {
  id: string;
  seasons: { s: number; ip?: number; pa?: number }[] | null;
  current?: number | string | null;
  level?: string;
}) {
  if (!seasons?.length || seasons.length < 2) return null;
  const base = level === "aaa" ? "/minors/player" : "/player";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mr-1">Season</span>
      {seasons.map((s) => {
        const on = String(s.s) === String(current);
        return (
          <Link key={s.s}
            href={`${base}/${id}?season=${s.s}`}
            title={s.ip != null ? `${s.ip} IP` : s.pa != null ? `${s.pa} PA` : undefined}
            className={`px-2.5 py-1 rounded-md text-[11px] font-data border transition-colors ${
              on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]"
                 : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"
            }`}>
            {s.s}
          </Link>
        );
      })}
    </div>
  );
}
