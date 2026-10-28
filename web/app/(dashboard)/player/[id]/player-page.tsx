import { type Level, getPlayerProfile, getHitterProfile, getPercentiles, getHitterPercentiles, getVaaZonePct, getArmSlot, getPitchRv, getZoneMix, getGameLog, getSpray, getSprayRefs, getHitterScouting, getScoutingLeague, getSituational, getVisuals, getCareer, getHitterSplitBenchmarks } from "@/lib/data";
import { vaaZoneRows } from "@/lib/vaa-zone";
import { profilePercentiles } from "@/lib/percentiles";
import { PlayerReady } from "@/components/ui/player-transition";
import { TeamTheme } from "@/components/ui/team-theme";
import { SeasonSelector } from "@/components/ui/season-selector";
import { PlayerProfileView } from "./profile-view";
import { HitterProfileView } from "./hitter-profile";
import Link from "next/link";

/** The profile page body for one level: MLB at /player/[id], AAA Statcast at /minors/player/[id]. */
export async function PlayerPage({ id, season, level = "mlb", extra }: {
  id: string; season?: string; level?: Level; extra?: React.ReactNode;
}) {
  let profile = await getPlayerProfile(id, season, level);
  let hitter: any = null;
  if (!profile) {
    hitter = await getHitterProfile(id, season, level);
  }
  const [vaaFile, slot, pitchRv, situational] = await Promise.all([
    getVaaZonePct(level),
    hitter ? Promise.resolve(null) : getArmSlot(id, level),
    hitter ? Promise.resolve(null) : getPitchRv(id, level),
    hitter ? Promise.resolve(null) : getSituational(id, level),
  ]);
  // Percentiles in the profile's OWN season; a season param that mismatches
  // the file falls back to the file's season.
  const detSeason = profile?.season ?? hitter?.season ?? season ?? "";
  const [gameLog, spray, sprayRefs, scouting, scoutingLeague, visuals, career, splitBench] = await Promise.all([
    detSeason ? getGameLog(id, detSeason, level) : Promise.resolve(null),
    hitter && detSeason ? getSpray(id, detSeason, level) : Promise.resolve(null),
    hitter ? getSprayRefs(level) : Promise.resolve(null),
    hitter && detSeason ? getHitterScouting(id, detSeason, level) : Promise.resolve(null),
    hitter ? getScoutingLeague(level) : Promise.resolve(null),
    detSeason ? getVisuals(id, detSeason, level) : Promise.resolve(null),
    getCareer(id, level),
    hitter ? getHitterSplitBenchmarks() : Promise.resolve(null),
  ]);
  const pctSeason = String(profile?.season ?? hitter?.season ?? season ?? "");
  const percentiles = hitter
    ? await getHitterPercentiles(pctSeason, level)
    : await getPercentiles(pctSeason, level);

  // Location mix (PP20): one season file, sliced to this pitcher server-side —
  // the client never downloads the whole league.
  let zoneMix: any = null;
  if (profile) {
    const zm = await getZoneMix(profile.season, level);
    if (zm?.meta) {
      zoneMix = {
        meta: zm.meta, league: zm.league ?? {}, leagueZone: zm.leagueZone ?? {},
        cellOrder: zm.cellOrder ?? [], zones: zm.zones ?? [],
        pitcher: zm.pitchers?.[String(id)] ?? null,
      };
    }
  }

  if (!profile && !hitter) {
    return (
      <div className="space-y-4">
        <Link
          href={level === "aaa" ? "/minors" : "/pitchers"}
          className="px-3 py-1 rounded-lg text-xs bg-white/[0.05] border border-border-subtle text-text-secondary hover:bg-white/[0.08] transition-all"
        >
          ← Back
        </Link>
        <div className="glass-panel p-8 text-center">
          <PlayerReady />
          <p className="text-sm text-text-dim">Player not found</p>
        </div>
      </div>
    );
  }

  // Only the two breakpoint sections cross to the client, not the whole file.
  const profilePcts = hitter ? null : profilePercentiles(percentiles);
  // Only his cells' ranks cross to the client, not the league breakpoint file.
  const vaaPct = hitter ? undefined : vaaZoneRows(vaaFile as any, profile.vaaByPitch || []);
  return (
    <>
      <PlayerReady />
      <TeamTheme team={hitter ? hitter.team : (profile as any)?.team} />
      {!hitter && level === "aaa" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded border border-usf-gold/50 bg-usf-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-usf-gold">
            MLB model on AAA data
          </span>
          <span className="text-[11px] text-text-dim">
            Whiff+ here is the MLB-trained model scored on his AAA pitches — display only; the site&apos;s K+/Prevention+/Control+/Pitching+ family is not validated below MLB.
          </span>
        </div>
      )}
      <SeasonSelector id={id} seasons={career?.seasons ?? null} current={detSeason} level={level} />
{hitter ? (
        <HitterProfileView profile={hitter} percentiles={percentiles} playerId={id}
          gameLog={gameLog} spray={spray} sprayRefs={sprayRefs} scouting={scouting}
          scoutingLeague={scoutingLeague} benchmarks={splitBench} visuals={visuals} level={level} />
      ) : (
        <PlayerProfileView
          profile={profile}
          percentiles={profilePercentiles(percentiles)}
          playerId={id}
          slot={slot}
          vaaPct={vaaPct}
          vaaSeason={vaaFile?.season}
          pitchRv={pitchRv}
          zoneMix={zoneMix}
          gameLog={gameLog}
          situational={situational}
          visuals={visuals}
          career={career}
          careerArsenal={career?.kind === "P" ? career.seasons : null}
          backHref={level === "aaa" ? "/minors" : undefined}
          level={level}
        />
      )}
      {extra}
    </>
  );
}
