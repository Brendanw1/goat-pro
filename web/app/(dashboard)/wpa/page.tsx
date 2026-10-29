import Link from "next/link";
import { type Level, getWpaIndex, getHitters, getPitchers } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { sortComparator } from "@/lib/table-sort";
import { playedFor } from "@/lib/boards/shared";
import { TeamCrest } from "@/components/ui/pixel-team-logo";

export const dynamic = "force-dynamic";

export const metadata = { title: "Win probability" };

type Q = { season?: string; side?: string; sort?: string; order?: string; level?: string; team?: string;
  ageMin?: string; ageMax?: string; min?: string; role?: string; n?: string };

/**
 * The WPA boards (depth list item 6): win probability added per plate
 * appearance, batting-team framed — positive is good for the hitter, and the
 * pitcher board's wpa is the same sum with the sign flipped (runs of win
 * probability prevented). Late & close is the classic context split: inning 7
 * or later within one run. Descriptive by nature — WPA prices the situation a
 * player happened to step into, which is why it is never coloured as skill.
 * Team, age and the season line are joined from the season boards by (id, season).
 */

type Col = { key: string; label: string; nd: number; tip?: string };
const H_COLS: Col[] = [
  { key: "age", label: "Age", nd: 0 },
  { key: "pa", label: "PA", nd: 0 },
  { key: "wpa", label: "WPA", nd: 2, tip: "Win probability added over his PAs (sum of swings)" },
  { key: "gained", label: "Gained", nd: 2, tip: "Sum of the PA swings that went his team's way (WPA+)" },
  { key: "lost", label: "Lost", nd: 2, tip: "Sum of the PA swings that went against his team (Gained − WPA)" },
  { key: "wpa100", label: "WPA/100", nd: 2, tip: "WPA per 100 PA" },
  { key: "lcWpa", label: "Late&close", nd: 2, tip: "WPA in inning 7+ within one run" },
  { key: "lcPa", label: "L&C PA", nd: 0 },
  { key: "woba", label: "wOBA", nd: 3 },
  { key: "ops", label: "OPS", nd: 3 },
];
const P_COLS: Col[] = [
  { key: "age", label: "Age", nd: 0 },
  { key: "role", label: "Role", nd: 0 },
  { key: "ip", label: "IP", nd: 1 },
  { key: "bf", label: "BF", nd: 0 },
  { key: "wpa", label: "WPA", nd: 2, tip: "Win probability prevented over his batters faced" },
  { key: "gained", label: "Gained", nd: 2, tip: "Sum of the PA swings that went his way" },
  { key: "lost", label: "Lost", nd: 2, tip: "Sum of the PA swings that went against him (Gained − WPA)" },
  { key: "wpa100", label: "WPA/100", nd: 2, tip: "WPA per 100 batters faced" },
  { key: "lcWpa", label: "Late&close", nd: 2, tip: "WPA in inning 7+ within one run" },
  { key: "era", label: "ERA", nd: 2 },
  { key: "fip", label: "FIP", nd: 2 },
  { key: "stuffPlus", label: "Whiff+", nd: 0 },
];

const fmt = (v: unknown, nd: number): string =>
  typeof v === "number" && Number.isFinite(v) ? (nd === 3 ? v.toFixed(3).replace(/^0/, "") : v.toFixed(nd)) : typeof v === "string" ? v : "—";
const num = (s: string | undefined) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

export default async function WpaPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const level: Level = q.level === "aaa" ? "aaa" : "mlb";
  const side = q.side === "pitchers" ? "pitchers" : "hitters";
  const [index, board] = await Promise.all([getWpaIndex(level), side === "hitters" ? getHitters(level) : getPitchers(level)]);
  const seasons = Object.keys(index?.seasons ?? {}).map(Number).sort((a, b) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const doc = index?.seasons?.[String(season)] ?? {};
  const cols = side === "hitters" ? H_COLS : P_COLS;
  const byKey = new Map((board ?? []).filter((r: any) => Number(r.season) === season).map((r: any) => [String(r.id), r]));
  const all: any[] = (doc[side] ?? []).map((r: any) => {
    const b: any = byKey.get(String(r.id)) ?? {};
    const n = side === "hitters" ? r.pa : r.bf;
    // the bake's hitter wpaPlus and pitcher wpaMinus are both the swings in the player's favour
    const gained: number | null = side === "hitters" ? r.wpaPlus ?? null : r.wpaMinus ?? null;
    return {
      ...r, team: b.team ?? null, teams: b.teams ?? null, age: b.age != null ? Math.floor(b.age) : null,
      gained, lost: gained != null ? gained - r.wpa : null, wpa100: n ? (100 * r.wpa) / n : null,
      woba: b.woba, ops: b.ops, role: b.role ?? null, ip: b.ip, era: b.era, fip: b.fip, stuffPlus: b.stuffPlus,
    };
  });
  const teams = [...new Set(all.flatMap((r) => [r.team, ...(r.teams ?? []).map((t: any) => t.team)]).filter(Boolean))].sort() as string[];
  const ageMin = num(q.ageMin), ageMax = num(q.ageMax), min = num(q.min);
  const rows = all.filter((r) =>
    (!q.team || playedFor(r, q.team)) &&
    (ageMin === null || (r.age ?? -1) >= ageMin) && (ageMax === null || (r.age ?? 999) <= ageMax) &&
    (min === null || (side === "hitters" ? r.pa : r.bf) >= min) &&
    (side === "hitters" || !q.role || r.role === q.role));
  const sortKey = cols.some((c) => c.key === q.sort) ? q.sort! : "wpa";
  const desc = q.order !== "asc";
  rows.sort(sortComparator(sortKey, desc ? "desc" : "asc"));
  const nShow = q.n === "all" ? rows.length : 100;
  const swings = doc.topSwings ?? [];
  const rank = new Map([...all].sort(sortComparator("wpa", "desc")).map((r, i) => [r.id, i + 1]));
  const profile = (id: string) => (level === "aaa" ? `/minors/player/${id}?season=${season}` : `/player/${id}?season=${season}`);

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const keep: Q = { level, season: String(season), side, sort: sortKey, order: desc ? "desc" : "asc", team: q.team,
    ageMin: q.ageMin, ageMax: q.ageMax, min: q.min, role: q.role, n: q.n };
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, String(v));
    return `/wpa?${p.toString()}`;
  };
  const input = "w-14 rounded-md border border-border-subtle bg-transparent px-1.5 py-0.5 text-[11px] font-data text-text-primary";

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Win probability</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Win probability added, per plate appearance, on the batting team&apos;s side of the ledger: what each
        hitter&apos;s PAs moved his team&apos;s chances by — and, flipped, what each pitcher prevented. Late &amp; close
        is inning 7 or later within one run. Descriptive: WPA pays for the situation a player steps into, so a
        middle reliever in high leverage reads differently than a starter with the same outing — that is the point.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={link({ level: "mlb", season: undefined, team: undefined })} className={chip(level === "mlb")}>MLB</Link>
        <Link href={link({ level: "aaa", season: undefined, team: undefined })} className={chip(level === "aaa")}>AAA</Link>
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {seasons.map((s) => (
          <Link key={s} href={link({ season: String(s) })} className={chip(s === season)}>{s}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ side: "hitters", sort: "wpa", role: undefined })} className={chip(side === "hitters")}>Hitters</Link>
        <Link href={link({ side: "pitchers", sort: "wpa" })} className={chip(side === "pitchers")}>Pitchers</Link>
        {side === "pitchers" && (
          <>
            <span className="w-px h-4 bg-border-subtle mx-1" />
            {[["", "All roles"], ["SP", "SP"], ["RP", "RP"]].map(([k, l]) => (
              <Link key={l} href={link({ role: k || undefined })} className={chip((q.role ?? "") === k)}>{l}</Link>
            ))}
          </>
        )}
      </div>
      <form method="get" action="/wpa" className="flex flex-wrap items-center gap-3 text-[11px] text-text-dim">
        {(["level", "season", "side", "sort", "order", "role", "n"] as const).map((k) => (keep[k] ? <input key={k} type="hidden" name={k} value={keep[k]} /> : null))}
        <label className="flex items-center gap-1">Team
          <select name="team" defaultValue={q.team ?? ""} className="rounded-md border border-border-subtle bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-primary">
            <option value="">All</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Age
          <input name="ageMin" type="number" min={17} max={50} defaultValue={q.ageMin} placeholder="min" className={input} />–
          <input name="ageMax" type="number" min={17} max={50} defaultValue={q.ageMax} placeholder="max" className={input} />
        </label>
        <label className="flex items-center gap-1">Min {side === "hitters" ? "PA" : "BF"}
          <input name="min" type="number" min={0} step={10} defaultValue={q.min} placeholder="50" className={input} />
        </label>
        <button type="submit" className={chip(false)}>Apply</button>
        {(q.team || q.ageMin || q.ageMax || q.min) && (
          <Link href={link({ team: undefined, ageMin: undefined, ageMax: undefined, min: undefined })} className="underline hover:text-text-secondary">clear</Link>
        )}
      </form>
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="pl-4 pr-1 py-2 text-right font-semibold" title="rank by WPA among every qualifier">#</th>
                <th className="px-2 py-2 text-left font-semibold">Player</th>
                <th className="px-2 py-2 text-left font-semibold">Team</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortKey ? (desc ? "descending" : "ascending") : undefined}>
                    <Link href={link({ sort: c.key, order: c.key === sortKey && desc ? "asc" : "desc" })} title={c.tip}
                      className={c.key === sortKey ? "text-text-primary" : "hover:text-text-secondary"}>
                      {c.label}{c.key === sortKey ? (desc ? " ▼" : " ▲") : ""}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, nShow).map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="pl-4 pr-1 py-1.5 text-right text-text-dim">{rank.get(r.id)}</td>
                  <td className="px-2 py-1.5 font-sans">
                    <Link href={profile(r.id)} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary"
                      title={r.teams?.length > 1 ? r.teams.map((t: any) => t.team).join(" → ") : undefined}>
                      <TeamCrest team={r.team} />{r.team ?? "—"}
                      {r.teams?.length > 1 ? <span className="text-text-dim">+{r.teams.length - 1}</span> : null}
                    </span>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortKey ? "text-text-primary" : "text-text-secondary"}`}>
                      {fmt(r[c.key], c.nd)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          <span>
            {rows.length.toLocaleString("en-US")} of {all.length.toLocaleString("en-US")} players · {side === "hitters" ? "50+ PA" : "50+ BF"} ·{" "}
            {nShow < rows.length ? <Link href={link({ n: "all" })} className="underline hover:text-text-secondary">show all</Link> : "all shown"}
          </span>
          <span>positive = helped his team</span>
        </div>
      </div>
      {swings.length > 0 && (
        <div className="glass-panel p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            The season&apos;s biggest swings — {season}
          </h2>
          <div className="grid gap-1">
            {swings.slice(0, 15).map((s: any, i: number) => (
              <div key={i} className="flex items-baseline gap-2 text-[11px] border-b border-white/[0.03] py-1">
                <span className="font-data text-text-dim shrink-0">{s.date}</span>
                <Link href={`/games/${s.gid}${level === "aaa" ? "?level=aaa" : ""}`} className="inline-flex items-center gap-1 self-center font-data text-text-secondary hover:underline shrink-0">
                  <TeamCrest team={s.away} size={13} />{s.away}<span className="text-text-dim">@</span><TeamCrest team={s.home} size={13} />{s.home}
                </Link>
                <span className="text-text-dim font-data shrink-0">{s.half === "Bot" ? "B" : "T"}{s.inning}</span>
                <span className="text-text-secondary leading-snug flex-1">
                  <Link href={profile(s.batterId)} className="hover:underline">{s.batter}</Link>
                  {" — "}{s.des}
                </span>
                {s.weBefore != null && (
                  <span className="font-data text-text-dim shrink-0" title="batting team's win probability before → after">
                    {Math.round(100 * s.weBefore)}→{Math.round(100 * s.weAfter)}%
                  </span>
                )}
                <span className="font-data shrink-0" style={{ color: (s.swing ?? 0) > 0 ? "#5ba88f" : "#e0654f" }}>
                  {(s.swing ?? 0) > 0 ? "+" : ""}{s.swing?.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
