import Link from "next/link";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { Signed } from "@/components/ui/shared-ui";

/** One trade as /trades and the team Trades tab show it: each club's haul, run value since the deal. */

export const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// the deadline window = its date and the two days before (deals land on the feed a day either side)
export const deadlineWindow = (deadline?: string | null) => {
  const dl = deadline ? new Date(`${deadline}T12:00:00Z`).getTime() : null;
  return (d: string) => dl != null && Math.abs(new Date(`${d}T12:00:00Z`).getTime() - dl) <= 2 * 864e5;
};

export function DealCard({ t, season, deadline, first }: { t: any; season: number; deadline: boolean; first?: string }) {
  const clubs: string[] = first ? [first, ...t.clubs.filter((c: string) => c !== first)] : t.clubs;
  return (
    <div className="glass-panel p-3">
      <div className="mb-2 flex items-baseline gap-2 text-[11px] text-text-dim">
        <span className="font-data">{md(t.date)}</span>
        {deadline && <span className="rounded border border-usf-gold/40 px-1 text-[9px] uppercase tracking-wider text-usf-gold">deadline</span>}
      </div>
      <div className={`grid gap-3 ${clubs.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {clubs.map((c) => (
          <div key={c}>
            <div className="mb-1 flex items-center gap-1.5 text-xs">
              <PixelTeamLogo team={c} size={16} />
              <span className="font-semibold text-text-primary">{c} got</span>
              <span className="ml-auto"><Signed v={t.got[c]} dp={1} /></span>
            </div>
            <table className="w-full text-xs font-data">
              <tbody>
                {t.players.filter((p: any) => p.to === c).map((p: any) => (
                  <tr key={p.id} className="border-t border-white/[0.04]">
                    <td className="py-0.5 font-sans">
                      <Link prefetch={false} href={`/player/${p.id}?season=${season}`} className="text-text-secondary hover:underline">{p.name}</Link>
                      <span className="ml-1 text-[10px] text-text-dim">{p.pos ?? ""}{p.rank ? ` · ${p.rank}` : ""}</span>
                    </td>
                    <td className="py-0.5 text-right text-[10px] text-text-dim">{p.pa ? `${p.pa} PA` : p.bf ? `${p.bf} BF` : p.debut ? `debut ${p.debut}` : "no MLB"}</td>
                    <td className="py-0.5 pl-2 text-right w-[52px]">{p.rvSince == null ? <span className="text-text-dim">—</span> : <Signed v={p.rvSince} dp={1} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
