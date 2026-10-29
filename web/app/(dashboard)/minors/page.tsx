import Link from "next/link";
import { sortComparator } from "@/lib/table-sort";
import { getMinorsIndex, getMinorsLines, getPitchers, getHitters } from "@/lib/data";

export const metadata = { title: "Minors" };

/**
 * Rookie through AAA (wave 8): two sources behind one board.
 *
 * `Lines` — MLB Stats API season lines for every level (minors_export.py), the
 * box-score view with the rates a line can carry (K%, BB%, K-BB%, WHIP, FIP).
 *
 * `Statcast` — the AAA bake (web_export.py --level aaa): the same board the MLB
 * side reads, over AAA pitches from 2023. Advanced columns (CSW%, Whiff%,
 * chase, RV/100, EV90, barrels) only exist where the tracked pitches are, so
 * this view is AAA-only and says so. Every row opens the full Statcast profile.
 *
 * Server-rendered: every control is a link that rewrites the query.
 */
const LEVELS = ["All", "AAA", "AA", "A+", "A", "ROK"];
const LEVEL_LABEL: Record<string, string> = { ROK: "Rookie" };
const PAGE = 100;

type Col = { key: string; label: string; nd?: number; lead?: boolean; asc?: boolean };
const COLS: Record<"pitchers" | "hitters", Col[]> = {
  pitchers: [
    { key: "age", label: "Age", nd: 1, asc: true }, { key: "g", label: "G" }, { key: "gs", label: "GS" },
    { key: "ip", label: "IP", nd: 1 }, { key: "era", label: "ERA", nd: 2, asc: true }, { key: "fip", label: "FIP", nd: 2, asc: true },
    { key: "whip", label: "WHIP", nd: 2, asc: true }, { key: "kPct", label: "K%", nd: 1 }, { key: "bbPct", label: "BB%", nd: 1, asc: true },
    { key: "kBbPct", label: "K-BB%", nd: 1 }, { key: "hr9", label: "HR/9", nd: 2, asc: true }, { key: "gbPct", label: "GB%", nd: 1 },
  ],
  hitters: [
    { key: "age", label: "Age", nd: 1, asc: true }, { key: "pos", label: "Pos" }, { key: "g", label: "G" }, { key: "pa", label: "PA" },
    { key: "avg", label: "AVG", nd: 3, lead: false }, { key: "obp", label: "OBP", nd: 3, lead: false },
    { key: "slg", label: "SLG", nd: 3, lead: false }, { key: "ops", label: "OPS", nd: 3, lead: false },
    { key: "iso", label: "ISO", nd: 3, lead: false }, { key: "kPct", label: "K%", nd: 1, asc: true },
    { key: "bbPct", label: "BB%", nd: 1 }, { key: "hr", label: "HR" }, { key: "sb", label: "SB" },
  ],
};

/** The Statcast views' columns: the advanced cuts, from the AAA bake's boards. */
const SC_COLS: Record<"pitchers" | "hitters", Col[]> = {
  pitchers: [
    { key: "age", label: "Age", nd: 1, asc: true }, { key: "ip", label: "IP", nd: 1 }, { key: "battersFaced", label: "BF" }, { key: "nPitches", label: "P" },
    { key: "kPct", label: "K%", nd: 1 }, { key: "bbPct", label: "BB%", nd: 1, asc: true }, { key: "kBbPct", label: "K-BB%", nd: 1 },
    { key: "cswPct", label: "CSW%", nd: 1 }, { key: "whiffPct", label: "Whiff%", nd: 1 },
    { key: "zonePct", label: "Zone%", nd: 1 }, { key: "chasePct", label: "Chase%", nd: 1 },
    { key: "oContactPct", label: "O-Con%", nd: 1, asc: true }, { key: "rvPer100", label: "RV/100", nd: 2, asc: true },
    { key: "stuffPlus", label: "Whiff+", nd: 1 },
  ],
  hitters: [
    { key: "age", label: "Age", nd: 1, asc: true }, { key: "pa", label: "PA" }, { key: "woba", label: "wOBA", nd: 3, lead: false },
    { key: "avg", label: "AVG", nd: 3, lead: false }, { key: "slg", label: "SLG", nd: 3, lead: false },
    { key: "kPct", label: "K%", nd: 1, asc: true }, { key: "bbPct", label: "BB%", nd: 1 },
    { key: "ev90", label: "EV90", nd: 1 }, { key: "maxEv", label: "MaxEV", nd: 1 },
    { key: "hardHitPct", label: "HH%", nd: 1 }, { key: "barrelPct", label: "Brl%", nd: 1 },
    { key: "whiffPct", label: "Whiff%", nd: 1, asc: true }, { key: "oSwingPct", label: "O-Swg%", nd: 1, asc: true },
  ],
};

const fmt = (v: unknown, c: Col): string => {
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const s = c.nd != null ? v.toFixed(c.nd) : String(v);
  return c.lead === false ? s.replace(/^0\./, ".") : s;
};

type Q = { kind?: string; season?: string; level?: string; min?: string; sort?: string; dir?: string; page?: string; src?: string; team?: string; age?: string };
const AGE_CAPS = [22, 24, 26];

export default async function MinorsPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const kind = q.kind === "hitters" ? "hitters" : "pitchers";
  const src = q.src === "sc" ? "sc" : "lines";
  const index = await getMinorsIndex();
  const lineSeasons: number[] = index?.[kind] ?? [];
  const season = Number.isFinite(Number(q.season)) && q.season !== undefined ? Number(q.season) : null;

  // Two data paths. Lines: one file per season, every level. Statcast: the AAA
  // bake's board (all seasons in one file), AAA-only by construction.
  let rows: any[] = [];
  let seasons: number[] = lineSeasons;
  let level = LEVELS.includes(q.level ?? "") ? q.level! : "All";
  let cols = COLS[kind];
  const floorKey = kind === "pitchers" ? "ip" : "pa";
  const defMin = kind === "pitchers" ? 20 : 100;
  let min = Number.isFinite(Number(q.min)) && q.min !== undefined ? Number(q.min) : defMin;
  let teams: string[] = [];
  let sortDefault = kind === "pitchers" ? "kBbPct" : "ops";
  // Age cap: season age (June 30) in whole years, so "≤ 22" keeps a 22.9-year-old.
  const maxAge = AGE_CAPS.includes(Number(q.age)) ? Number(q.age) : null;
  const ageOk = (r: any) => maxAge == null || (typeof r.age === "number" && Math.floor(r.age) <= maxAge);

  if (src === "sc") {
    const board = kind === "pitchers" ? await getPitchers("aaa") : await getHitters("aaa");
    seasons = [...new Set((board ?? []).map((r: any) => r.season))].sort((a: number, b: number) => b - a);
    const seasonSel = season != null && seasons.includes(season) ? season : seasons[0];
    level = "AAA";
    cols = SC_COLS[kind];
    sortDefault = kind === "pitchers" ? "kBbPct" : "woba";
    min = Number.isFinite(Number(q.min)) && q.min !== undefined ? Number(q.min) : defMin;
    const team = q.team ?? "";
    teams = [...new Set((board ?? []).map((r: any) => r.team).filter(Boolean))].sort();
    rows = (board ?? [])
      .filter((r: any) => r.season === seasonSel && (!team || r.team === team) && (r[floorKey] ?? 0) >= min && ageOk(r))
      .map((r: any) => ({ ...r, level: "AAA" }));
    var seasonShown = seasonSel;
  } else {
    const seasonSel = season != null && lineSeasons.includes(season) ? season : lineSeasons[lineSeasons.length - 1];
    const file = seasonSel ? await getMinorsLines(kind, seasonSel) : null;
    const team = q.team ?? "";
    teams = [...new Set((file?.rows ?? []).map((r: any) => r.team).filter(Boolean))] as string[];
    rows = (file?.rows ?? [])
      .filter((r: any) => (level === "All" || r.level === level) && (!team || r.team === team) && (r[floorKey] ?? 0) >= min && ageOk(r));
    var seasonShown = seasonSel;
  }
  const sortCol = cols.find((c) => c.key === q.sort) ?? cols.find((c) => c.key === sortDefault)!;
  const dir = q.sort && (q.dir === "asc" || q.dir === "desc") ? q.dir : sortCol.asc ? "asc" : "desc";
  rows.sort(sortComparator(sortCol.key, dir));
  const page = Math.max(0, Number(q.page) || 0);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const link = (over: Partial<Q>) => {
    const p = new URLSearchParams();
    const m = { kind, src, season: String(seasonShown ?? ""), level, min: String(min), sort: sortCol.key, dir: q.dir, page: "0", team: q.team ?? "", age: maxAge ? String(maxAge) : "", ...over };
    for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/minors?${p.toString()}`;
  };
  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Minor leagues</h1>
      <p className="text-xs text-text-dim max-w-[70ch]">
        {src === "sc"
          ? "The AAA Statcast board: the same advanced read the MLB side carries — CSW%, whiff, chase, run value, exit-velocity quality — over tracked AAA pitches from 2023. Whiff+ is the MLB-trained model scored on AAA pitches, labelled MLB model on AAA data (display only); the rest of the model family is not validated below MLB."
          : `Season lines for every level from the MLB Stats API, ${lineSeasons[0]}–${lineSeasons[lineSeasons.length - 1]}. AAA players also have full Statcast profiles from 2023 — switch to the Statcast board for the advanced read.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {(["pitchers", "hitters"] as const).map((k) => (
          <Link key={k} href={link({ kind: k, sort: undefined, min: undefined })} className={chip(k === kind)}>{k === "pitchers" ? "Pitchers" : "Hitters"}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href={link({ src: "lines", sort: undefined, level: undefined })} className={chip(src === "lines")}>Lines</Link>
        <Link href={link({ src: "sc", sort: undefined, level: "AAA", team: undefined })} className={chip(src === "sc")}>Statcast (AAA)</Link>
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {seasons.slice(0, 8).map((s) => <Link key={s} href={link({ season: String(s) })} className={chip(s === seasonShown)}>{s}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {src === "lines" && LEVELS.map((l) => <Link key={l} href={link({ level: l })} className={chip(l === level)}>{LEVEL_LABEL[l] ?? l}</Link>)}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        {(kind === "pitchers" ? [0, 20, 50, 100] : [0, 100, 250, 400]).map((m) => (
          <Link key={m} href={link({ min: String(m) })} className={chip(m === min)}>{m === 0 ? "All" : `${m}+ ${kind === "pitchers" ? "IP" : "PA"}`}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Age</span>
        <Link href={link({ age: undefined })} className={chip(maxAge == null)}>All</Link>
        {AGE_CAPS.map((a) => <Link key={a} href={link({ age: String(a) })} className={chip(a === maxAge)}>≤ {a}</Link>)}
      </div>
      {teams.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mr-1">Team</span>
          <Link href={link({ team: undefined })} className={chip(!q.team)}>All</Link>
          {teams.map((t) => <Link key={t} href={link({ team: t })} className={chip(q.team === t)}>{t}</Link>)}
        </div>
      )}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-4 py-2 text-left font-semibold">Player</th>
                <th className="px-2 py-2 text-left font-semibold">Level</th>
                <th className="px-2 py-2 text-left font-semibold">Team</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-semibold" aria-sort={c.key === sortCol.key ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                    <Link href={link({ sort: c.key, dir: c.key === sortCol.key ? (dir === "desc" ? "asc" : "desc") : undefined })} className={c.key === sortCol.key ? "text-text-primary" : "hover:text-text-secondary"}>{c.label}{c.key === sortCol.key ? (dir === "desc" ? " ▼" : " ▲") : ""}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r: any, i: number) => (
                <tr key={`${r.id}-${r.level}-${i}`} className="border-t border-white/[0.04]">
                  <td className="px-4 py-1.5 font-sans">
                    <Link href={`/minors/player/${r.id}?season=${seasonShown}`} className="text-text-primary hover:underline">{r.name ?? r.id}</Link>
                  </td>
                  <td className="px-2 py-1.5 font-sans text-text-secondary">{LEVEL_LABEL[r.level] ?? r.level}</td>
                  <td className="px-2 py-1.5 font-sans text-text-secondary">{r.team ?? "—"}</td>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 text-right ${c.key === sortCol.key ? "text-text-primary" : "text-text-secondary"}`}>{fmt(r[c.key], c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-text-dim">
        <span>{rows.length.toLocaleString("en-US")} {kind}</span>
        {page > 0 && <Link href={link({ page: String(page - 1) })} className="text-text-secondary hover:underline">← Previous</Link>}
        {(page + 1) * PAGE < rows.length && <Link href={link({ page: String(page + 1) })} className="text-text-secondary hover:underline">Next →</Link>}
      </div>
    </div>
  );
}
