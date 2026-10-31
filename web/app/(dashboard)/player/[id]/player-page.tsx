import { BackLink } from "@/components/ui/back-link";
import { type Level, getPlayerProfile, getHitterProfile, getPercentiles, getHitterPercentiles, getVaaZonePct, getArmSlot, getPitchRv, getZoneMix, getGameLog, getSpray, getSprayRefs, getHitterScouting, getScoutingLeague, getSituational, getPitchPlan, getPitchPlanLeague, getVisuals, getCareer, getHitterSplitBenchmarks, getProspectRank, getSwingProfile, getSavantBoard, getLoadProfile, getLoadIndex, getAgingTrack, getAgingCurves, getDeception } from "@/lib/data";
import { vaaZoneRows } from "@/lib/vaa-zone";
import { profilePercentiles } from "@/lib/percentiles";
import { PlayerReady } from "@/components/ui/player-transition";
import { TeamTheme } from "@/components/ui/team-theme";
import { SeasonSelector } from "@/components/ui/season-selector";
import { AgingStrip } from "@/components/ui/aging-strip";
import { PlayerProfileView } from "./profile-view";
import { HitterProfileView } from "./hitter-profile";
import Link from "next/link";
import { WpaAbsStrip } from "@/components/ui/wpa-abs-strip";

/** The profile page body for one level: MLB at /player/[id], AAA Statcast at /minors/player/[id]. */
/** The scouting league the client needs: this season's count rows and only the zone splits he has, on his sides. */
function leagueSlice(lg: any, rs: string, zones: Record<string, { s: string }> | undefined) {
  const s = rs ? lg?.seasons?.[rs] : null;
  if (!s) return null;
  const z: Record<string, Record<string, unknown>> = {};
  for (const [k, sp] of Object.entries(zones ?? {})) (z[sp.s] ??= {})[k] = s.zgrid?.[sp.s]?.[k];
  return { seasons: { [rs]: { counts: s.counts, zgrid: z } } };
}

export async function PlayerPage({ id, season, tab, level = "mlb", extra }: {
  id: string; season?: string; tab?: string; level?: Level; extra?: React.ReactNode;
}) {
  // Other level's career, for the MLB/AAA toggle; started now so it rides wave 1
  // (both roles: which one this page shows is known only after wave 1).
  const otherLevel = level === "aaa" ? "mlb" : "aaa";
  const otherCareerP = { p: getCareer(id, otherLevel, "p"), h: getCareer(id, otherLevel, "h") };
  // Wave 1: the pitcher and hitter docs in parallel (a 404 is cheap; the hitter
  // doc is used only when there is no pitcher doc, as before).
  let [profile, hitterDoc] = await Promise.all([
    getPlayerProfile(id, season, level, { noBoardFallback: true }),
    getHitterProfile(id, season, level),
  ]);
  // Neither file: last resort is the leaderboard row (needs pitchers.json).
  if (!profile && !hitterDoc) profile = await getPlayerProfile(id, season, level);
  const hitter: any = profile ? null : hitterDoc;
  // Wave 2: everything else at once. Every input is known after wave 1 (the
  // profile's own season, role, level); these used to be eight serial R2 hops.
  // Percentiles are in the profile's OWN season; a season param that mismatches
  // the file falls back to the file's season.
  const detSeason = profile?.season ?? hitter?.season ?? season ?? "";
  const pctSeason = String(profile?.season ?? hitter?.season ?? season ?? "");
  const pid = profile?.season ?? season;
  const rs = hitter ? String(hitter.season) : "";
  const role = hitter ? "h" : "p";
  // Baserunning detail (Savant reference): slice this hitter's rows from the
  // league board files server-side, like zoneMix — the client gets 4 rows.
  // Savant boards are MLB; an AAA page must not show his MLB rows.
  const board = (f: string) => hitter && level === "mlb" ? getSavantBoard(f).catch(() => null) : Promise.resolve(null);
  const [
    vaaFile, slot, pitchRv, situational, pitchPlan, pitchPlanLeague,
    gameLog, spray, sprayRefs, scouting, scoutingLeague, visuals, career, splitBench, prospectRank, swing,
    bsrBoard, stealBoard, xbBoard, sprintBoard,
    deceptionDoc, loadDoc, loadIdx,
    agingTrack, agingCurves, percentiles, zm,
  ] = await Promise.all([
    getVaaZonePct(level),
    hitter ? null : getArmSlot(id, pid, level),
    hitter ? null : getPitchRv(id, level),
    hitter ? null : getSituational(id, pid, level),
    hitter ? null : getPitchPlan(id, pid, level),
    hitter ? null : getPitchPlanLeague(level),
    detSeason ? getGameLog(id, detSeason, level, role) : null,
    hitter && detSeason ? getSpray(id, detSeason, level) : null,
    hitter ? getSprayRefs(level) : null,
    hitter && detSeason ? getHitterScouting(id, detSeason, level) : null,
    hitter ? getScoutingLeague(level) : null,
    detSeason ? getVisuals(id, detSeason, level, role) : null,
    getCareer(id, level, role),
    hitter ? getHitterSplitBenchmarks(level) : null,
    getProspectRank(id),
    hitter && detSeason ? getSwingProfile(id, detSeason, level) : null,
    board("baserunning_rv"), board("basestealing_rv"), board("xb_taken"), board("sprint_speed"),
    profile && detSeason ? getDeception(id, detSeason) : null,
    profile && detSeason ? getLoadProfile(id, detSeason, level) : null,
    profile ? getLoadIndex() : null,
    // By-age strip (depth item 7): his track on the league curve, both roles.
    getAgingTrack(id),
    getAgingCurves(),
    hitter ? getHitterPercentiles(pctSeason, level) : getPercentiles(pctSeason, level),
    // Location mix (PP20): one season file, sliced to this pitcher server-side —
    // the client never downloads the whole league.
    profile ? getZoneMix(profile.season, level) : null,
  ]);
  const pick = (rows: any[] | undefined) =>
    (rows ?? []).find((rw: any) => String(rw.id) === String(id) && String(rw.season) === rs) ?? null;
  const running: any = hitter && level === "mlb" ? {
    season: rs,
    bsr: pick(bsrBoard?.rows), steal: pick(stealBoard?.rows),
    xb: pick(xbBoard?.rows), sprint: pick(sprintBoard?.rows),
  } : null;
  // Fatigue profile (pitchers): the load doc plus that season's league TTO
  // baselines from the index, merged so the tab renders one object.
  const deception: any = deceptionDoc;
  const load: any = loadDoc ? { ...loadDoc, league: loadIdx?.league?.[String(loadDoc.season)] ?? null } : null;
  // rendered once here (server) and placed inside each view's Overview tab
  const agingStrip = (
    <AgingStrip track={agingTrack} curves={agingCurves}
      role={hitter ? "batter" : "pitcher"} season={detSeason} />
  );
  let zoneMix: any = null;
  if (profile && zm?.meta) {
    zoneMix = {
      meta: zm.meta, league: zm.league ?? {}, leagueZone: zm.leagueZone ?? {},
      cellOrder: zm.cellOrder ?? [], zones: zm.zones ?? [],
      pitcher: zm.pitchers?.[String(id)] ?? null,
    };
  }

  if (!profile && !hitter) {
    return (
      <div className="space-y-4">
        <BackLink
          fallback={level === "aaa" ? "/minors" : "/pitchers"}
          className="px-3 py-1 rounded-lg text-xs bg-white/[0.05] border border-border-subtle text-text-secondary hover:bg-white/[0.08] transition-all"
        />
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
      <SeasonSelector id={id} seasons={career?.seasons ?? null} current={detSeason} level={level} otherSeasons={(await otherCareerP[role])?.seasons ?? null} />
      {detSeason ? <WpaAbsStrip id={id} season={detSeason} level={level} name={(hitter ?? profile)?.name} team={(hitter ?? profile)?.team} /> : null}
      <div className="no-print flex flex-wrap items-center gap-4">
        <Link prefetch={false} href={`/player/${id}/sheet?season=${detSeason}${level === "aaa" ? "&level=aaa" : ""}`}
          className="text-[11px] text-text-dim hover:text-text-secondary underline-offset-2 hover:underline">
          Printable sheet →
        </Link>
        {(prospectRank?.draft || prospectRank?.debut) && (
          <span className="flex items-center gap-1.5 text-[10px] font-data text-text-dim">
            {prospectRank.draft && (
              <span title={`${prospectRank.draft.school ?? ""}${prospectRank.draft.school ? " ·" : ""} ${prospectRank.draft.team ?? ""}`}>
                {prospectRank.draft.round === "1" ? "1st" : `${prospectRank.draft.round}${prospectRank.draft.round === "2" ? "nd" : "rd"}`} round
                {prospectRank.draft.pick ? ` · #${prospectRank.draft.pick} overall` : ""} · {prospectRank.draft.year}
              </span>
            )}
            {prospectRank.draft && prospectRank.debut ? " ·" : ""}
            {prospectRank.debut && <span>MLB debut {prospectRank.debut}</span>}
          </span>
        )}
        {prospectRank?.ranks?.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Pipeline prospect ranking</span>
            {prospectRank.ranks.slice(0, 8).map((r: any) => {
              const kind = String(r.list).split(":")[0];
              const label = kind === "top100" ? "top 100" : kind === "team" ? String(r.team ?? r.teamSlug ?? "team").replace(/^./, (c) => c.toUpperCase()) : r.pos ?? "pos";
              return (
              <Link key={`${r.season}-${r.list}-${r.rank}`}
                href={`/prospects?year=${r.season}&view=${kind === "top100" ? "top100" : kind === "team" ? "team" : "pos"}${kind === "team" ? "&team=" + (r.teamSlug || "") : kind === "position" ? "&pos=" + (r.posSlug || "") : ""}`}
                title={`${r.season}: #${r.rank} ${label}`}
                className="inline-flex items-center gap-1 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] font-data text-text-secondary hover:bg-white/[0.04]">
                {r.season} · #{r.rank} {label}
              </Link>
              );
            })}
          </span>
        )}
      </div>
{hitter ? (
        <HitterProfileView profile={hitter} percentiles={percentiles} playerId={id} agingStrip={agingStrip}
          gameLog={gameLog} spray={spray} sprayRefs={sprayRefs} scouting={scouting}
          scoutingLeague={leagueSlice(scoutingLeague, rs, scouting?.zgrid)} benchmarks={splitBench} career={career} visuals={visuals} swing={swing} running={running} initialTab={tab} level={level} />
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
          pitchPlan={pitchPlan}
          pitchPlanLeague={pitchPlanLeague}
          visuals={visuals}
          career={career}
          careerArsenal={career?.kind === "P" ? career.seasons : null}
          backHref={level === "aaa" ? "/minors" : undefined}
          level={level}
        load={load} deception={deception} initialTab={tab} agingStrip={agingStrip} />
      )}
      {extra}
    </>
  );
}
