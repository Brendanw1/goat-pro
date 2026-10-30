import Link from "next/link";
import { getRosters40, getRostersMoves } from "@/lib/data";
import { TeamCrest } from "@/components/ui/pixel-team-logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "40-man rosters" };

/**
 * The 40-man tracker (D-47): each club's current 40-man with its API status, and
 * the movement since spring reporting — the adds and removes the offseason has
 * produced so far (Rule 5 protection, tender deadline, trades, DFA). The roster
 * payload carries name / position / status only: options remaining, service class
 * and acquisition source are needs-source and are flagged, not faked. The
 * decision-date diffs (protection, tender) arrive when this year's snapshots do.
 */

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
  const chip = "rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary";
  const statusChip = (s: string) => (
    <span className="ml-1.5 rounded border border-usf-gold/40 px-1 py-px text-[9px] uppercase tracking-wide text-usf-gold">{s}</span>
  );
  const playerLink = (p: any) => p.lnk
    ? <Link href={`/player/${p.id}`} className="text-text-primary hover:underline">{p.n}</Link>
    : <span className="text-text-secondary">{p.n}</span>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">40-man rosters</h1>
          <p className="text-xs text-text-dim max-w-[90ch]">
            Each club&apos;s current 40-man as of {board.updated}, from MLB&apos;s date-honored roster endpoint,
            with the movement since spring reporting ({moves?.since ?? "—"}). Status rides the API&apos;s roster
            field (60-day IL and restricted show beside the name). <span className="text-text-secondary">Not on the
            card yet: options remaining, service class and acquisition source — the roster payload doesn&apos;t
            carry them, and the sources that do carry terms.</span>
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

      <div className="glass-panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{sel.abbr} 40-man ({sel.n})</span>
          <span className="text-[10px] text-text-dim">positions as the API lists them; linked names have a profile here</span>
        </div>
        <div className="grid gap-x-6 gap-y-0.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {sel.players.map((p: any) => (
            <div key={p.id} className="flex items-baseline gap-2 text-xs" style={{ minHeight: "24px" }}>
              <span className="w-7 text-[10px] font-data text-text-dim">{p.p}</span>
              <span>
                {playerLink(p)}
                {p.s ? statusChip(p.s) : null}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-text-dim max-w-[100ch]">
        Snapshot {board.updated} · movement window {moves?.since ?? "—"} → {board.updated}. The research layer — what
        predicts a 40-man removal at the tender deadline, and what happens to fringe players after a trade — is
        pre-registered separately and needs this year&apos;s protection and tender snapshots (due in November).
      </p>
    </div>
  );
}
