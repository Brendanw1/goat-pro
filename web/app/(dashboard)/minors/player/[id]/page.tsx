import { getPlayerProfile, getHitterProfile, getMinorsIndex, getMinorsLines } from "@/lib/data";
import { PlayerPage } from "../../../player/[id]/player-page";
import { CareerByLevel } from "@/components/ui/career-by-level";
import { PlayerReady } from "@/components/ui/player-transition";
import Link from "next/link";

/** A minor leaguer: the AAA Statcast profile when he has one, else his line by level alone. */
async function latestLine(id: string) {
  const index = await getMinorsIndex();
  for (const kind of ["pitchers", "hitters"] as const) {
    for (const s of [...(index?.[kind] ?? [])].reverse()) {
      const row = (await getMinorsLines(kind, s))?.rows?.find((r: any) => r.id === id);
      if (row) return { ...row, season: s, kind };
    }
  }
  return null;
}

export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const season = (await searchParams)?.season;
  const p = (await getPlayerProfile(id, season, "aaa")) ?? (await getHitterProfile(id, season, "aaa")) ?? (await latestLine(id));
  return { title: p?.name ? `${p.name} (Minors)` : "Player Not Found" };
}

export default async function MinorsPlayerPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const season = (await searchParams)?.season;
  const aaa = (await getPlayerProfile(id, season, "aaa")) ?? (await getHitterProfile(id, season, "aaa"));
  const back = (
    <Link href="/minors" className="px-3 py-1 rounded-lg text-xs bg-white/[0.05] border border-border-subtle text-text-secondary hover:bg-white/[0.08] transition-all">
      ← Minors
    </Link>
  );
  if (aaa) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-white/[0.06] text-text-secondary">
            AAA · Statcast
          </span>
        </div>
        <PlayerPage id={id} season={season} level="aaa" extra={<CareerByLevel id={id} />} />
      </div>
    );
  }
  const line = await latestLine(id);
  return (
    <div className="space-y-4">
      <PlayerReady />
      {back}
      {line ? (
        <div className="glass-panel p-4">
          <h1 className="text-xl font-semibold text-text-primary">{line.name}</h1>
          <p className="text-[11px] text-text-dim mt-0.5">
            {line.team} · {line.level === "ROK" ? "Rookie" : line.level} · {line.season}
            {line.kind === "pitchers" ? ` · throws ${line.throws ?? "—"}` : ` · ${line.pos ?? ""} · bats ${line.bats ?? "—"}`}
          </p>
        </div>
      ) : (
        <div className="glass-panel p-8 text-center text-sm text-text-dim">Player not found</div>
      )}
      <CareerByLevel id={id} />
    </div>
  );
}
