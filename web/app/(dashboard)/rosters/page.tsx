import Link from "next/link";
import { getRosters40, getRostersMoves } from "@/lib/data";
import { TeamCrest } from "@/components/ui/pixel-team-logo";
import { logoUrl } from "@/lib/team-pixel";
import { TeamTheme } from "@/components/ui/team-theme";
import { Signed } from "@/components/ui/shared-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "40-man rosters" };

/**
 * The 40-man tracker (D-47): each club's current 40-man with its API status, and
 * the movement since spring reporting — the adds and removes the offseason has
 * produced so far (Rule 5 protection, tender deadline, trades, DFA). The roster
 * payload carries name / position / status only: options remaining, service class
 * and acquisition source are needs-source and are flagged, not faked. The
 * decision-date diffs (protection, tender) arrive when this year's snapshots do.
 * D-44 v1 adds UNOFFICIAL service / control estimates (pipeline/service_time.py,
 * docs/service-time-method.md) from Stats API transactions — not contract data.
 */

const SPOTRAC = "https://www.spotrac.com/mlb/";
const COTS = "https://legacy.baseballprospectus.com/compensation/cots/";
const EST_TIP = "Unofficial estimates from MLB Stats API transactions; not contract data. Service = days on the active roster or injured list (172 = 1 year), seeded from each opening-day 40-man and walked through the season's transactions. Status: pre-arb / arb-1..3 / arb-4+ / 6+, S2 = estimated Super Two. Control thru = the last season before 6.000 if he spends every day up from here; extensions and contracts override it. ~ = uncertain (contradictory transaction walk or within 15 days of a boundary). Salaries, options and no-trade clauses: see Spotrac / Cot's.";

export default async function RostersPage({ searchParams }: {
  searchParams?: Promise<{ team?: string }>;
}) {
  const team = ((await searchParams)?.team ?? "").toUpperCase();
  const [board, moves] = await Promise.all([getRosters40(), getRostersMoves()]);
  if (!board) {
    return <div className="glass-panel p-6 text-sm text-text-dim">40-man snapshots not baked yet.</div>;
  }
  const sel = board.teams.find((t: any) => t.abbr === team) ?? board.teams.find((t: any) => t.abbr === "LAD") ?? board.teams[0];
  const mv = moves?.teams?.find((t: any) => t.abbr === sel.abbr) ?? null;
  const crest = logoUrl(sel.abbr);
  const chip = "rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary";
  const statusChip = (s: string) => (
    <span className="ml-1.5 rounded border border-usf-gold/40 px-1 py-px text-[9px] uppercase tracking-wide text-usf-gold">{s}</span>
  );
  const playerLink = (p: any) => p.lnk
    ? <Link href={`/player/${p.id}`} className="text-text-primary hover:underline">{p.n}</Link>
    : <span className="text-text-secondary">{p.n}</span>;

  return (
    <div className="space-y-4">
      <TeamTheme team={sel.abbr} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            {crest ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={crest} alt="" width={34} height={34} className="rounded" />
            ) : null}
            <h1 className="text-lg font-semibold text-text-primary">{sel.abbr} 40-man roster</h1>
          </div>
          <p className="text-xs text-text-dim max-w-[90ch]">
            Each club&apos;s current 40-man as of {board.updated}, from MLB&apos;s date-honored roster endpoint,
            with the movement since spring reporting ({moves?.since ?? "—"}). Status rides the API&apos;s roster
            field (60-day IL and restricted show beside the name). <span className="text-text-secondary">Not on the
            card yet: options remaining, service class and acquisition source — the roster payload doesn&apos;t
            carry them, and the sources that do carry terms. Service and control-through columns are our own
            unofficial estimates from MLB transactions (hover for the method).</span>
          </p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <select name="team" defaultValue={sel.abbr} className={chip}>
            {board.teams.map((t: any) => <option key={t.abbr} value={t.abbr}>{t.abbr}</option>)}
          </select>
          <button className={chip}>Go</button>
        </form>
      </div>

      {mv && (mv.adds.length > 0 || mv.removes.length > 0) ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="glass-panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <TeamCrest team={sel.abbr} size={16} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                Added since {moves.since} ({mv.adds.length})
              </span>
            </div>
            <ul className="space-y-1 text-xs">
              {mv.adds.map((p: any) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="w-8 text-[10px] font-data text-text-dim">{p.p}</span>
                  {playerLink(p)}
                </li>
              ))}
              {!mv.adds.length && <li className="text-text-dim">none</li>}
            </ul>
          </div>
          <div className="glass-panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <TeamCrest team={sel.abbr} size={16} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">
                Removed since {moves.since} ({mv.removes.length})
              </span>
            </div>
            <ul className="space-y-1 text-xs">
              {mv.removes.map((p: any) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="w-8 text-[10px] font-data text-text-dim">{p.p}</span>
                  {playerLink(p)}
                </li>
              ))}
              {!mv.removes.length && <li className="text-text-dim">none</li>}
            </ul>
          </div>
        </div>
      ) : null}

      {sel.trade?.length ? (
        <div className="glass-panel p-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <TeamCrest team={sel.abbr} size={16} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim"
              title="Possible trade candidates (descriptive, not a forecast) · A transparent rule, not a model: the study of trades already made (§107) describes who gets moved but has no held-out signal to fit weights on · A player is listed when all three hold: his §105 removal score sits in the league's middle band (not core, not DFA fodder), his best own WAR of the last two seasons is below his club's median, and he sits behind the club's starter slots at his position (C/IF 1, OF 3, DH 1, SP 5, RP 7, depth by that WAR) · It cannot see contracts, options, no-trade clauses or a club's intent (contract data is not built) — it says who looks movable, not who will move">
              Possible trade candidates ({sel.trade.length}) ⓘ
            </span>
          </div>
          <p className="mb-2 text-[10px] text-text-dim">Blocked at his spot, below the club&apos;s median WAR, mid removal score. A descriptive rule, not a forecast; contracts, options and no-trade clauses are not seen.</p>
          <ul className="space-y-1 text-xs">
            {sel.trade.map((p: any) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-7 text-[10px] font-data text-text-dim">{p.g}</span>
                {playerLink(p)}
                <span className="text-[11px] text-text-dim">
                  #{p.rank} of {p.of} {p.g} behind {p.by} ({p.byW.toFixed(1)}) · WAR <Signed v={p.w} dp={1} /> &apos;26, <Signed v={p.w1} dp={1} /> &apos;25 · removal {Math.round(100 * p.rem)}%
                  {p.svc ? <span title={EST_TIP}> · service {p.svc} est.{p.ctl ? `, control thru ${p.ctl} (est.)` : ", control set by contract"}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{sel.abbr} 40-man ({sel.n})</span>
          <span className="text-[10px] text-text-dim">the % is the §105 removal score — the modelled chance he is off a 40-man by spring if this were the tender deadline (descriptive)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
                <th className="px-3 py-1.5 font-semibold">Pos</th>
                <th className="px-3 py-1.5 font-semibold">Player</th>
                <th className="px-3 py-1.5 font-semibold" title={EST_TIP}>Service (est.) ⓘ</th>
                <th className="px-3 py-1.5 font-semibold" title={EST_TIP}>Control thru (est.) ⓘ</th>
                <th className="px-3 py-1.5 font-semibold text-right">Removal</th>
              </tr>
            </thead>
            <tbody>
              {sel.players.map((p: any) => (
                <tr key={p.id} className="border-t border-border-subtle/50">
                  <td className="px-3 py-1 text-[10px] font-data text-text-dim">{p.p}</td>
                  <td className="px-3 py-1">{playerLink(p)}{p.s ? statusChip(p.s) : null}</td>
                  <td className="px-3 py-1 font-data text-text-secondary" title={EST_TIP}>
                    {p.svc ? <>{p.unc ? "~" : ""}{p.svc} <span className="text-[10px] text-text-dim">{p.st}{p.s2 ? " · S2" : ""}</span></> : <span className="text-text-dim">pre-MLB</span>}
                  </td>
                  <td className="px-3 py-1 font-data text-text-secondary" title={EST_TIP}>
                    {p.ctl ? <>{p.unc ? "~" : ""}{p.ctl}</> : p.st === "6+" ? <span className="text-[10px] text-text-dim">contract</span> : <span className="text-text-dim">—</span>}
                  </td>
                  <td className="px-3 py-1 text-right font-data text-[10px] text-text-dim"
                    title="Removal score (§105, descriptive): the modelled probability this player is off a 40-man by spring if this were the tender deadline — a cross-fit model over five cycles (held-out AUC .805), which sees age, tenure, workload, K% and run value. It cannot see options or service class.">
                    {p.rem != null ? `${Math.round(100 * p.rem)}%` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-text-dim max-w-[100ch]">
        Snapshot {board.updated} · movement window {moves?.since ?? "—"} → {board.updated}. The research layer — what
        predicts a 40-man removal at the tender deadline, and what happens to fringe players after a trade — is
        pre-registered separately and needs this year&apos;s protection and tender snapshots (due in November).
      </p>
      <p className="text-[10px] leading-relaxed text-text-dim max-w-[100ch]">
        Service and control: unofficial estimates from MLB Stats API transactions; not contract data. Salaries, options
        and no-trade clauses: see <a href={SPOTRAC} target="_blank" rel="noopener noreferrer" className="underline">Spotrac</a> / <a
        href={COTS} target="_blank" rel="noopener noreferrer" className="underline">Cot&apos;s</a>. Method and error sources:
        docs/service-time-method.md. Roster and transaction data: Copyright {board.updated.slice(0, 4)} MLB Advanced
        Media, L.P. Use of any content on this page acknowledges agreement to the terms posted at <a
        href="http://gdx.mlb.com/components/copyright.txt" target="_blank" rel="noopener noreferrer"
        className="underline">gdx.mlb.com/components/copyright.txt</a>.
      </p>
    </div>
  );
}
