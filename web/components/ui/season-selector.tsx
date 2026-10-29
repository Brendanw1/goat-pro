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

export function SeasonSelector({ id, seasons, current, level, otherSeasons }: {
  id: string;
  seasons: { s: number; ip?: number; pa?: number }[] | null;
  current?: number | string | null;
  level?: string;
  /** His seasons at the other level (MLB <-> AAA); a level toggle shows when he has any. */
  otherSeasons?: { s: number }[] | null;
}) {
  const hasOther = !!otherSeasons?.length;
  if (!hasOther && (!seasons?.length || seasons.length < 2)) return null;
  const aaa = level === "aaa";
  const base = aaa ? "/minors/player" : "/player";
  const chip = (on: boolean) => `px-2.5 py-1 rounded-md text-[11px] font-data border transition-colors ${
    on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  // Same season at the other level when he has it, else that level's latest.
  const otherSeason = otherSeasons?.some((o) => String(o.s) === String(current)) ? current : otherSeasons?.at(-1)?.s;
  const otherHref = `${aaa ? "/player" : "/minors/player"}/${id}${otherSeason ? `?season=${otherSeason}` : ""}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hasOther && (
        <span className="mr-2 flex items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mr-1">Level</span>
          {aaa ? <Link href={otherHref} className={chip(false)}>MLB</Link> : <span className={chip(true)}>MLB</span>}
          {aaa ? <span className={chip(true)}>AAA</span> : <Link href={otherHref} className={chip(false)}>AAA</Link>}
        </span>
      )}
      {seasons && seasons.length > 1 && <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mr-1">Season</span>}
      {seasons && seasons.length > 1 && seasons.map((s) => {
        const on = String(s.s) === String(current);
        return (
          <Link key={s.s}
            href={`${base}/${id}?season=${s.s}`}
            title={s.ip != null ? `${s.ip} IP` : s.pa != null ? `${s.pa} PA` : undefined}
            className={chip(on)}>
            {s.s}
          </Link>
        );
      })}
    </div>
  );
}
