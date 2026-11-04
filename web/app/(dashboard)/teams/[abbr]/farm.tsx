import Link from "next/link";
import { getOrgFarm, getOrgDepth, getProspectsSeason, getPitchers, getHitters } from "@/lib/data";

/**
 * The Farm tab (docs/team-pages-plan.md, phase 1): every affiliate Rookie through AAA, ranked against its level, the
 * org's Pipeline-ranked prospects with their lines, org leaderboards, and the Depth sub-view (position x level).
 * Stats API season lines are descriptive; the AAA Statcast grades are MLB-trained models scored on AAA pitches
 * (display only), joined by player id from the AAA bake. Server-rendered, every control a link.
 */

const LEVEL_LABEL: Record<string, string> = { ROK: "Rookie", CPX: "Complex", DSL: "DSL" };
const MODEL_TIP = "MLB-trained model scored on AAA pitches (display only); AAA 2023+ rows";
const fmt = (v: unknown, nd = 0): string => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(nd) : "—");
const rate3 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(3).replace(/^0/, "") : "—");

type Link_ = (over: Record<string, string | undefined>) => string;

function Rk({ rk, n }: { rk?: number | null; n: number }) {
  if (rk == null) return null;
  const top = rk <= Math.ceil(n / 3), bot = rk > n - Math.ceil(n / 3);
  return <span className={`ml-1 text-[9px] ${top ? "text-emerald-400" : bot ? "text-rose-400" : "text-text-dim"}`}>{rk}/{n}</span>;
}

function playerHref(id: string, level: string, season: number) {
  return level === "MLB" ? `/player/${id}?season=${season}` : `/minors/player/${id}?season=${season}`;
}

function Affiliates({ farm }: { farm: any }) {
  const t = farm.totals ?? {};
  const H = [["ops", "OPS", rate3], ["iso", "ISO", rate3], ["kPct", "K%", (v: any) => fmt(v, 1)], ["bbPct", "BB%", (v: any) => fmt(v, 1)]] as const;
  const P = [["era", "ERA", (v: any) => fmt(v, 2)], ["fip", "FIP", (v: any) => fmt(v, 2)], ["kPct", "K%", (v: any) => fmt(v, 1)],
    ["bbPct", "BB%", (v: any) => fmt(v, 1)], ["kBbPct", "K-BB%", (v: any) => fmt(v, 1)]] as const;
  return (
    <div className="glass-panel p-4 overflow-x-auto">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Affiliates, {farm.season}</h2>
      <table className="w-full text-[11px] font-data">
        <thead className="text-text-dim">
          <tr>
            <th className="text-left font-normal py-1">Level</th><th className="text-left font-normal">Club</th>
            <th className="text-right font-normal">PA</th>{H.map(([k, l]) => <th key={`h${k}`} className="text-right font-normal">{l}</th>)}
            <th className="text-right font-normal pl-3">IP</th>{P.map(([k, l]) => <th key={`p${k}`} className="text-right font-normal">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {farm.affiliates.map((a: any) => (
            <tr key={a.teamId} className="border-t border-white/[0.04]">
              <td className="py-1 text-text-secondary">{a.level === "ROK" ? LEVEL_LABEL[a.tier] : a.level}</td>
              <td className="text-text-primary">{a.team} <span className="text-text-dim">{a.league}</span></td>
              <td className="text-right text-text-dim">{a.hit.pa}</td>
              {H.map(([k, , f]) => <td key={k} className="text-right">{f(a.hit[k])}<Rk rk={a.hit.rk?.[k]} n={a.nTier} /></td>)}
              <td className="text-right text-text-dim pl-3">{fmt(a.pitch.ip, 1)}</td>
              {P.map(([k, , f]) => <td key={k} className="text-right">{f(a.pitch[k])}<Rk rk={a.pitch.rk?.[k]} n={a.nTier} /></td>)}
            </tr>
          ))}
          <tr className="border-t border-white/[0.12] text-text-primary">
            <td className="py-1 font-semibold" colSpan={2}>Whole farm (rank of {farm.nOrgs} orgs)</td>
            <td className="text-right text-text-dim">{fmt(t.h_pa)}</td>
            {H.map(([k, , f]) => <td key={k} className="text-right">{f(t[`h_${k}`])}<Rk rk={t[`h_${k}_rk`]} n={farm.nOrgs} /></td>)}
            <td className="text-right text-text-dim pl-3">{fmt(t.p_ip, 1)}</td>
            {P.map(([k, , f]) => <td key={k} className="text-right">{f(t[`p_${k}`])}<Rk rk={t[`p_${k}_rk`]} n={farm.nOrgs} /></td>)}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-text-dim leading-[1.5]">
        Stats API season lines (descriptive). Each club is ranked against the other clubs at its level that season; Rookie
        splits into the US complex leagues (ACL, FCL) and the DSL. FIP uses each level&apos;s own constant; the farm FIP is the
        innings-weighted mean of its affiliates&apos;.
      </p>
    </div>
  );
}

/** A player's main level that season (most PA / BF), for the prospect rows. */
function mainRow(rows: any[], id: string, w: string) {
  return rows.filter((r) => r.id === id).sort((a, b) => (b[w] ?? 0) - (a[w] ?? 0))[0];
}

function Prospects({ farm, list, aaaP, aaaH }: { farm: any; list: any[]; aaaP: Map<string, any>; aaaH: Map<string, any> }) {
  if (!list.length) return null;
  return (
    <div className="glass-panel p-4 overflow-x-auto">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Ranked prospects, {farm.season}</h2>
      <table className="w-full text-[11px] font-data">
        <thead className="text-text-dim"><tr>
          <th className="text-left font-normal py-1">Org #</th><th className="text-left font-normal">Player</th><th className="text-left font-normal">Pos</th>
          <th className="text-right font-normal">Age</th><th className="text-left font-normal pl-3">Level</th><th className="text-left font-normal">Line</th>
          <th className="text-right font-normal" title={MODEL_TIP}>AAA model</th><th className="text-right font-normal">ETA</th>
        </tr></thead>
        <tbody>
          {list.map((p: any) => {
            const pitcher = /HP$|^P$/.test(p.pos ?? "");
            const r = pitcher ? mainRow(farm.pitchers, p.id, "bf") : mainRow(farm.hitters, p.id, "pa");
            const sc = pitcher ? aaaP.get(p.id) : aaaH.get(p.id);
            const line = !r ? "no line this season" : pitcher
              ? `${fmt(r.ip, 1)} IP · ${fmt(r.fip, 2)} FIP · ${fmt(r.kBbPct, 1)} K-BB%`
              : `${r.pa} PA · ${rate3(r.ops)} OPS · ${fmt(r.kPct, 1)} K% · ${fmt(r.bbPct, 1)} BB%`;
            const model = !sc ? "" : pitcher ? `Whiff+ ${fmt(sc.stuffPlus)} · K+ ${fmt(sc.kPlus)}` : `xwOBA ${rate3(sc.xwoba)}`;
            return (
              <tr key={p.id} className="border-t border-white/[0.04]">
                <td className="py-1 text-text-dim">{p.rank}</td>
                <td><Link prefetch={false} href={playerHref(p.id, r?.level ?? "AAA", farm.season)} className="text-text-primary hover:underline">{p.n}</Link></td>
                <td className="text-text-secondary">{p.pos}</td>
                <td className="text-right">{fmt(r?.age ?? p.age, 1)}</td>
                <td className="pl-3 text-text-secondary">{r ? (r.level === "ROK" ? `Rookie (${r.lg})` : r.level) : "—"}</td>
                <td className="text-text-primary">{line}</td>
                <td className="text-right text-text-secondary">{model || "—"}</td>
                <td className="text-right text-text-dim">{p.eta ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-text-dim leading-[1.5]">
        Ranks are MLB Pipeline&apos;s published org list, quoted. The line is the player&apos;s main level this season (most PA or
        batters faced). The AAA model column is shown only for AAA Statcast seasons (2023+).
      </p>
    </div>
  );
}

const LV_CHIPS = ["All", "AAA", "AA", "A+", "A", "ROK"];

function Board({ title, rows, cols, note }: { title: string; rows: any[]; cols: [string, string, (r: any) => string][]; note?: string }) {
  return (
    <div className="glass-panel p-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">{title}</h2>
      {rows.length ? (
        <table className="w-full text-[11px] font-data">
          <thead className="text-text-dim"><tr>
            <th /><th className="text-left font-normal">Player</th><th className="text-left font-normal">Lvl</th>
            {cols.map(([k, l]) => <th key={k} className="text-right font-normal">{l === "age" ? "Age" : l}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={`${r.id}-${r.level}`} className="border-t border-white/[0.03]">
                <td className="py-0.5 w-5 text-text-dim">{i + 1}</td>
                <td><Link prefetch={false} href={playerHref(r.id, r.level, r.season)} className="text-text-primary hover:underline">{r.name}</Link></td>
                <td className="text-text-dim">{r.level === "ROK" ? `ROK ${r.lg ?? ""}` : r.level}</td>
                {cols.map(([k, l, f]) => <td key={k} className="text-right" title={l}>{f(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-[11px] text-text-dim">No player clears the floor.</p>}
      {note ? <p className="mt-1.5 text-[10px] text-text-dim">{note}</p> : null}
    </div>
  );
}

function Leaders({ farm, lv, link, aaaP, aaaH }: { farm: any; lv: string; link: Link_; aaaP: Map<string, any>; aaaH: Map<string, any> }) {
  const at = (r: any) => lv === "All" || r.level === lv;
  const s = farm.season;
  const hit = farm.hitters.filter((r: any) => at(r) && r.pa >= 100).map((r: any) => ({ ...r, season: s }));
  const pit = farm.pitchers.filter((r: any) => at(r) && r.bf >= 100).map((r: any) => ({ ...r, season: s }));
  const top = (rows: any[], k: string, asc = false) => [...rows].sort((a, b) => (asc ? 1 : -1) * ((a[k] ?? -1e9) - (b[k] ?? -1e9))).slice(0, 10);
  const scP = farm.pitchers.filter((r: any) => r.level === "AAA" && aaaP.has(r.id)).map((r: any) => ({ ...r, ...aaaP.get(r.id), level: "AAA", season: s }))
    .filter((r: any) => (r.nPitches ?? 0) >= 500);
  const scH = farm.hitters.filter((r: any) => r.level === "AAA" && aaaH.has(r.id)).map((r: any) => ({ ...r, ...aaaH.get(r.id), level: "AAA", season: s }))
    .filter((r: any) => (r.pa ?? 0) >= 100);
  const age = (r: any) => fmt(r.age, 1);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">Org leaders</span>
        {LV_CHIPS.map((l) => (
          <Link key={l} prefetch={false} href={link({ lv: l === "All" ? undefined : l })}
            className={`px-2 py-0.5 rounded text-[10px] border ${l === lv ? "border-usf-gold/60 text-text-primary" : "border-border-subtle text-text-secondary"}`}>
            {l === "ROK" ? "Rookie" : l}
          </Link>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Board title="Hitters by OPS (100+ PA)" rows={top(hit, "ops")} cols={[["age", "age", age], ["pa", "PA", (r) => String(r.pa)], ["ops", "OPS", (r) => rate3(r.ops)], ["iso", "ISO", (r) => rate3(r.iso)]]} />
        <Board title="Pitchers by K-BB% (100+ BF)" rows={top(pit, "kBbPct")} cols={[["age", "age", age], ["ip", "IP", (r) => fmt(r.ip, 1)], ["kBbPct", "K-BB%", (r) => fmt(r.kBbPct, 1)], ["fip", "FIP", (r) => fmt(r.fip, 2)]]} />
        <Board title="AAA Whiff+ (500+ pitches)" rows={top(scP, "stuffPlus")} note={MODEL_TIP}
          cols={[["stuffPlus", "Whiff+", (r) => fmt(r.stuffPlus)], ["kPlus", "K+", (r) => fmt(r.kPlus)], ["preventionPlus", "Prev+", (r) => fmt(r.preventionPlus)]]} />
        <Board title="AAA hitters by xwOBA (100+ PA)" rows={top(scH, "xwoba")} note="expected wOBA from contact quality, AAA Statcast 2023+"
          cols={[["xwoba", "xwOBA", (r) => rate3(r.xwoba)], ["ev90", "EV90", (r) => fmt(r.ev90, 1)], ["barrelPct", "Barrel%", (r) => fmt(r.barrelPct, 1)]]} />
      </div>
    </div>
  );
}

function Depth({ depth }: { depth: any }) {
  if (!depth) return <p className="text-[11px] text-text-dim">No depth file for this season.</p>;
  const cell = (pos: string, lv: string) => {
    const xs: any[] = depth.grid?.[pos]?.[lv] ?? [];
    const n = pos === "SP" || pos === "RP" ? 5 : 3;
    return (
      <td key={lv} className="align-top py-1 pr-2">
        {xs.slice(0, n).map((e) => (
          <div key={e.id} className="leading-[1.35]">
            <Link prefetch={false} href={playerHref(e.id, lv, depth.season)} className="text-text-primary hover:underline">{e.name ?? e.id}</Link>
            <span className="text-text-dim"> {e.g}{pos === "SP" ? " GS" : " G"}{e.lg && lv === "ROK" ? ` ${e.lg}` : ""}</span>
          </div>
        ))}
        {xs.length > n ? <div className="text-text-dim">+{xs.length - n} more</div> : null}
      </td>
    );
  };
  return (
    <div className="glass-panel p-4 overflow-x-auto">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Depth by position, {depth.season}</h2>
      <table className="w-full text-[11px] font-data min-w-[820px]">
        <thead className="text-text-dim"><tr>
          <th className="text-left font-normal py-1 w-10">Pos</th>
          {depth.levels.map((l: string) => <th key={l} className="text-left font-normal">{l === "ROK" ? "Rookie" : l}</th>)}
        </tr></thead>
        <tbody>
          {depth.positions.map((pos: string) => (
            <tr key={pos} className="border-t border-white/[0.04]">
              <td className="py-1 text-text-secondary align-top">{pos}</td>
              {depth.levels.map((l: string) => cell(pos, l))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-text-dim leading-[1.5]">
        Minor leagues: games played at each position (Stats API fielding), so a utility player appears at every spot he
        played. MLB: the listed position and games. Pitchers: starters by games started, relievers by relief appearances.
        Rookie covers the complex leagues and the DSL.
      </p>
    </div>
  );
}

export default async function FarmTab({ abbr, season, q, link }: { abbr: string; season: number; q: Record<string, string>; link: Link_ }) {
  const [farm, depth, plist, aaaPitch, aaaHit] = await Promise.all([
    getOrgFarm(abbr, season), getOrgDepth(abbr, season), getProspectsSeason(season),
    season >= 2023 ? getPitchers("aaa") : Promise.resolve([]), season >= 2023 ? getHitters("aaa") : Promise.resolve([]),
  ]);
  if (!farm) return <p className="text-[11px] text-text-dim">No farm data for {season} (minor-league lines cover 2021 on).</p>;
  const view = q.fv === "depth" ? "depth" : "farm";
  const lv = LV_CHIPS.includes(q.lv ?? "") ? q.lv! : "All";
  const bySeason = (rows: any[]) => new Map((rows ?? []).filter((r: any) => r.season === season).map((r: any) => [String(r.id), r]));
  const aaaP = bySeason(aaaPitch as any[]), aaaH = bySeason(aaaHit as any[]);
  const list = Object.values<any[]>(plist?.teams ?? {}).flat().filter((p: any) => p.org === abbr).sort((a, b) => a.rank - b.rank);
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(["farm", "depth"] as const).map((v) => (
          <Link key={v} prefetch={false} href={link({ fv: v === "farm" ? undefined : v })}
            className={`px-2.5 py-1 rounded-md text-[11px] border ${v === view ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary"}`}>
            {v === "farm" ? "Farm" : "Depth"}
          </Link>
        ))}
      </div>
      {view === "depth" ? <Depth depth={depth} /> : (
        <>
          <Affiliates farm={farm} />
          <Prospects farm={farm} list={list} aaaP={aaaP} aaaH={aaaH} />
          <Leaders farm={farm} lv={lv} link={link} aaaP={aaaP} aaaH={aaaH} />
        </>
      )}
    </div>
  );
}
