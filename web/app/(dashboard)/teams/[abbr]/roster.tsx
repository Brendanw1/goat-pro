import Link from "next/link";
import { getOrgRoster, getRosters40, getRostersMoves } from "@/lib/data";
import { EST_TIP } from "../../rosters/est";
import { md } from "../../trades/deal";

/**
 * Roster tab: the club's current 40-man (rosters40, D-47) grouped by role, where each player played this season by
 * level and his injured-list stints (orgs/{abbr}/roster.json from transactions_full), plus the offseason moves.
 */

const LVS = ["MLB", "AAA", "AA", "A+", "A", "ROK"];
const GROUPS: [string, (p: string) => boolean][] = [
  ["Pitchers", (p) => p === "P"],
  ["Catchers", (p) => p === "C"],
  ["Infielders", (p) => ["1B", "2B", "3B", "SS", "IF"].includes(p)],
  ["Outfielders, DH, two-way", () => true],
];
// rosters40 keeps the API's ARI / OAK
const R40 = (abbr: string) => ({ AZ: "ARI", ATH: "OAK" } as Record<string, string>)[abbr];

export default async function RosterTab({ abbr }: { abbr: string }) {
  const [board, moves, ro] = await Promise.all([getRosters40(), getRostersMoves(), getOrgRoster(abbr)]);
  const sel = board?.teams?.find((t: any) => t.abbr === abbr || t.abbr === R40(abbr));
  if (!sel) return <div className="glass-panel p-6 text-sm text-text-dim">No 40-man snapshot for {abbr}.</div>;
  const mv = moves?.teams?.find((t: any) => t.abbr === sel.abbr);
  const info = (id: string) => ro?.players?.[id] ?? { lv: {}, il: [] };
  const left: any[] = [...sel.players];
  const groups = GROUPS.map(([label, f]) => {
    const g = left.filter((p) => f(p.p));
    g.forEach((p) => left.splice(left.indexOf(p), 1));
    return [label, g.sort((a, b) => (info(b.id).lv.MLB ?? 0) - (info(a.id).lv.MLB ?? 0))] as [string, any[]];
  });
  const onIL = sel.players.filter((p: any) => p.s && /injured/i.test(p.s));
  const name = (p: any) => p.lnk
    ? <Link prefetch={false} href={`/player/${p.id}`} className="text-text-primary hover:underline">{p.n}</Link>
    : <Link prefetch={false} href={`/minors/player/${p.id}`} className="text-text-secondary hover:underline">{p.n}</Link>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim max-w-[95ch]">
        The current 40-man ({sel.n}) as of {board.updated}, grouped by role. <strong className="text-text-secondary">Levels</strong>: games
        at each level in {ro?.season ?? "this season"} from the Stats API lines (Rookie = ACL, FCL and DSL).{" "}
        <strong className="text-text-secondary">IL</strong>: this season&apos;s injured-list stints from the transactions feed
        (placed → activated; a move to the 60-day keeps the stint open). Service and control are our unofficial estimates
        (hover). The league-wide tracker is on <Link href={`/rosters?team=${sel.abbr}`} className="underline">40-man rosters</Link>.
      </p>
      {onIL.length > 0 && (
        <div className="glass-panel p-3 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">On the injured list now ({onIL.length})</span>
          <span className="ml-2 text-text-secondary">{onIL.map((p: any) => `${p.n} (${p.s.replace("Injured ", "")})`).join(" · ")}</span>
        </div>
      )}
      {groups.filter(([, g]) => g.length).map(([label, g]) => (
        <div key={label} className="glass-panel overflow-hidden">
          <div className="px-4 py-2 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">{label} ({g.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="px-3 py-1.5 font-semibold w-10">Pos</th>
                  <th className="px-3 py-1.5 font-semibold">Player</th>
                  <th className="px-3 py-1.5 font-semibold">Levels (G)</th>
                  <th className="px-3 py-1.5 font-semibold">IL this season</th>
                  <th className="px-3 py-1.5 font-semibold" title={EST_TIP}>Service (est.) ⓘ</th>
                  <th className="px-3 py-1.5 font-semibold" title={EST_TIP}>Control (est.) ⓘ</th>
                </tr>
              </thead>
              <tbody>
                {g.map((p) => {
                  const x = info(p.id);
                  return (
                    <tr key={p.id} className="border-t border-border-subtle/50 align-top">
                      <td className="px-3 py-1 text-[10px] font-data text-text-dim">{p.p}</td>
                      <td className="px-3 py-1">{name(p)}{p.s ? <span className="ml-1.5 rounded border border-usf-gold/40 px-1 py-px text-[9px] uppercase tracking-wide text-usf-gold">{p.s}</span> : null}</td>
                      <td className="px-3 py-1 font-data text-[11px] text-text-secondary">
                        {LVS.filter((l) => x.lv[l]).map((l) => <span key={l} className="mr-2 whitespace-nowrap"><span className="text-text-dim">{l === "ROK" ? "Rk" : l}</span> {x.lv[l]}</span>)}
                        {!LVS.some((l) => x.lv[l]) && <span className="text-text-dim">did not play</span>}
                      </td>
                      <td className="px-3 py-1 text-[11px] text-text-dim">
                        {x.il.map((s: any, i: number) => (
                          <div key={i} className="whitespace-nowrap">{s.list} · {md(s.from)}–{s.to ? md(s.to) : "open"}{s.team ? <span className="text-text-dim/70"> · {s.team}</span> : null}</div>
                        ))}
                      </td>
                      <td className="px-3 py-1 font-data text-text-secondary" title={EST_TIP}>
                        {p.svc ? <>{p.unc ? "~" : ""}{p.svc} <span className="text-[10px] text-text-dim">{p.st}{p.s2 ? " · S2" : ""}</span></> : <span className="text-text-dim">pre-MLB</span>}
                      </td>
                      <td className="px-3 py-1 font-data text-text-secondary" title={EST_TIP}>
                        {p.ctl ? <>{p.unc ? "~" : ""}{p.ctl}</> : p.st === "6+" ? <span className="text-[10px] text-text-dim">contract</span> : <span className="text-text-dim">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {mv && (mv.adds.length > 0 || mv.removes.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {([["Added", mv.adds], ["Removed", mv.removes]] as [string, any[]][]).map(([k, list]) => (
            <div key={k} className="glass-panel p-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{k} since {moves.since} ({list.length})</div>
              <ul className="space-y-1 text-xs">
                {list.map((p) => <li key={p.id} className="flex gap-2"><span className="w-8 text-[10px] font-data text-text-dim">{p.p}</span>{name(p)}</li>)}
                {!list.length && <li className="text-text-dim">none</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
