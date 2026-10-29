"use client";

/**
 * Hitter profile, wave-2b surface: slash header, measured percentile panel
 * (production, contact quality, discipline), the batted-ball mix, and splits
 * vs hand and pitch family (PH2). All measured, all descriptive; xwOBA and
 * the decision grades are NEEDS-MODEL and stripped. Percentile rows use the
 * same hollow small-sample treatment as the pitcher side.
 */
import { PITCH_CONFIG } from "@/lib/constants";
import { statRow, PercentileGroup, PercentilePanel, ThinSampleBanner } from "@/components/ui/percentile-row";
import { DefensePanel } from "@/components/ui/defense-panel";
import { AboutThis } from "@/components/ui/discipline-block";
import { ProfileTabs, ProfileTabPanel, TABS_FOR } from "@/components/ui/profile-tabs";
import { logoUrl, teamPixels } from "@/lib/team-pixel";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { getStatPercentileRank, PROFILE_PCT_FLOOR } from "@/lib/percentiles";
import { signedFixed, TeamLine, TeamSplitsDetails } from "@/components/ui/shared-ui";
import { useState } from "react";
import { GameLogPanel } from "@/components/ui/game-log-panel";
import { SeasonArc } from "@/components/ui/season-arc";
import { YoYDelta } from "@/components/ui/yoy-delta";
import { SprayPanel } from "@/components/ui/spray-panel";
import { ScoutingCard, ZoneGridPanel, CountsPanel } from "@/components/ui/scouting-card";
import { HitterVisualsTab } from "@/components/ui/visuals-tab";
import { SwingTab } from "@/components/ui/swing-tab";
import { TrendPanel } from "@/components/ui/trend-panel";
import { RollingPanel } from "@/components/ui/rolling-panel";
import { LeagueScatter, RvFamilyBars, ProjectionBand } from "@/components/ui/league-views";

const pct1 = (v: number) => v.toFixed(1);
const dec3 = (v: number) => v.toFixed(3).replace(/^0/, "");

/** The Statcast pitch families the splits fold into (mirrors the bake). */
const FAM_LABEL: Record<string, string> = {
  FB: "Fastballs (FF/SI)", CT: "Cutters", BR: "Breaking (SL/SW/CB/KC)", OS: "Offspeed (CH/FS/EP)",
};

export function HitterProfileView({ profile, percentiles, playerId, gameLog, spray, sprayRefs, scouting, scoutingLeague, benchmarks, career, visuals, swing, running, initialTab, agingStrip, level }: {
  profile: any;
  percentiles: any;
  playerId: string;
  gameLog?: any | null;
  spray?: any | null;
  sprayRefs?: any | null;
  scouting?: any | null;
  scoutingLeague?: any | null;
  benchmarks?: any | null;
  career?: any | null;
  visuals?: any | null;
  swing?: any | null;
  running?: any | null;
  initialTab?: string | null;
  agingStrip?: React.ReactNode;
  level?: string;
}) {
  // ?tab= deep link (the swing board links here); stale keys fall back to Overview.
  const [tab, setTab] = useState<any>(
    initialTab && TABS_FOR.batter.some((x) => x.key === initialTab) ? initialTab : "overview");
  const seasonBp = percentiles?.by_season?.[String(profile.season)] ?? null;
  const denseWoba = percentiles?.dense?.[String(profile.season)]?.woba ?? null;

  const pa = typeof profile.pa === "number" ? profile.pa : null;
  const thinPa = pa !== null && pa < PROFILE_PCT_FLOOR.bf ? { n: pa, unit: "PA", floor: PROFILE_PCT_FLOOR.bf } : null;
  const bipThin = typeof profile.nBip === "number" && profile.nBip < 25 ? { n: profile.nBip, unit: "BIP", floor: 25 } : null;
  const sampleLine = [
    pa !== null ? `${pa} PA` : null,
    typeof profile.pitchesSeen === "number" ? `${profile.pitchesSeen.toLocaleString()} pitches seen` : null,
    typeof profile.nBip === "number" ? `${profile.nBip} balls in play` : null,
    `${profile.season} season`,
  ].filter(Boolean).join(" · ");

  /**
   * Discipline rows: rank the sample-adjusted twin against the season's shrunk
   * population (both baked), print the raw rate. Raw-vs-raw fallback.
   */
  const shrunkBp = (percentiles as any)?.shrunk_by_season?.[String(profile.season)] ?? null;
  const hDiscRow = (key: string, label: string) => {
    const twin = profile?.[`${key}Shrunk`];
    const useShrunk = typeof twin === "number" && shrunkBp?.[key];
    return statRow(
      "hitter", key, label,
      useShrunk ? twin : profile?.[key],
      pct1,
      useShrunk ? shrunkBp[key] : seasonBp?.[key],
      thinPa,
      useShrunk ? `${key}Shrunk` : key,
      useShrunk ? (typeof profile?.[key] === "number" ? `${(profile[key] as number).toFixed(1)}%` : undefined) : undefined,
    );
  };

  /** Header sub-line: the rank with its ordinal, blank when unrankable. */
  const headerRankText = (label: string, v: unknown): string => {
    const key = ({ woba: "woba", "k%": "kPct" } as Record<string, string>)[label.toLowerCase()] ?? label.toLowerCase();
    const r = rank(key, v);
    if (r === null) return "";
    const rem10 = r % 10, rem100 = r % 100;
    const suf = rem10 === 1 && rem100 !== 11 ? "st" : rem10 === 2 && rem100 !== 12 ? "nd" : rem10 === 3 && rem100 !== 13 ? "rd" : "th";
    return `${r}${suf}`;
  };

  /** rank from the season population (dense wOBA for the header chips only). */
  const rank = (key: string, v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (key === "woba" && denseWoba?.q) {
      const below = denseWoba.q.filter((x: number) => x < v).length;
      return Math.max(1, Math.min(99, Math.round((100 * below) / denseWoba.q.length)));
    }
    if (!seasonBp?.[key]) return null;
    return getStatPercentileRank(key, v, seasonBp[key]);
  };

  const px = teamPixels(profile.team);
  const shade = px
    ? `radial-gradient(90% 60% at 12% 0%, ${px.bg}38 0%, transparent 62%), radial-gradient(70% 50% at 95% 8%, ${px.ink}1A 0%, transparent 55%)`
    : undefined;
  const crest = logoUrl(profile.team);

  const vsHand = profile.vsHand ?? [];
  const vsFamily = profile.vsFamily ?? [];

  // The bake nests by measure first, then season: {hand: {"2026": {...}}, family: …, type: …}.
  const bmSeason = String(profile.season);
  const seasonBm = {
    hand: benchmarks?.hand?.[bmSeason] ?? null,
    family: benchmarks?.family?.[bmSeason] ?? null,
    type: benchmarks?.type?.[bmSeason] ?? null,
  };
  const slash = (v: unknown) => (typeof v === "number" ? v.toFixed(3).replace(/^0/, "") : "—");
  const splitTable = (rows: any[], labelFn: (v: string) => string, bench: Record<string, any> | null = null) => (
    <div className="overflow-x-auto"><div className="min-w-max">
      <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
        <div className="w-[130px]">Split</div>
        <div className="w-[48px] text-right">PA</div>
        <div className="w-[48px] text-right">AVG</div>
        <div className="w-[48px] text-right">OBP</div>
        <div className="w-[48px] text-right">SLG</div>
        <div className="w-[48px] text-right">wOBA</div>
        <div className="w-[48px] text-right">K%</div>
        <div className="w-[56px] text-right">Avg EV</div>
      </div>
      {rows.map((r) => {
        const benchRow = bench?.[r.v] ?? null;
        return (
          <div key={r.v} className="border-b border-white/[0.025]">
            <div className="flex items-center px-4" style={{ height: "34px" }}
              title={r.pa < 50 ? `${r.pa} PA — thin split; read it as a lean` : undefined}>
              <div className="w-[130px] text-xs font-medium text-text-primary">{labelFn(r.v)}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{r.pa}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{slash(r.avg)}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{slash(r.obp)}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{slash(r.slg)}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{slash(r.woba)}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{r.kPct ?? "—"}</div>
              <div className="w-[56px] text-right text-xs font-data text-text-secondary">{r.avgEv ?? "—"}</div>
            </div>
            {benchRow && (
              <div className="flex items-center px-4 bg-white/[0.02]" style={{ height: "26px" }}
                title="League line for this split cell, same season, 50+ PA hitters">
                <div className="w-[130px] text-[11px] text-text-dim">↳ league</div>
                <div className="w-[48px] text-right text-xs font-data text-text-dim">{(benchRow.pa ?? 0).toLocaleString("en-US")}</div>
                <div className="w-[48px] text-right text-xs font-data text-text-dim">{slash(benchRow.avg)}</div>
                <div className="w-[48px] text-right text-xs font-data text-text-dim">{slash(benchRow.obp)}</div>
                <div className="w-[48px] text-right text-xs font-data text-text-dim">{slash(benchRow.slg)}</div>
                <div className="w-[48px] text-right text-xs font-data text-usf-gold/80">{slash(benchRow.woba)}</div>
                <div className="w-[48px] text-right text-xs font-data text-text-dim">{benchRow.kPct ?? "—"}</div>
                <div className="w-[56px] text-right text-xs font-data text-text-dim">{benchRow.avgEv ?? "—"}</div>
              </div>
            )}
          </div>
        );
      })}
      {!rows.length && <p className="px-4 py-3 text-[11px] text-text-dim">No split reached 25 PA.</p>}
    </div></div>
  );

  const faced = (profile.faced ?? []) as { t: string; n: number; pa: number; swingPct?: number | null; whiffPct?: number | null; hardPct?: number | null; avgEv?: number | null }[];

  return (
    <div className="space-y-5 -m-2 p-2" style={{ background: shade, backgroundAttachment: "fixed", minHeight: "100vh" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border border-border-subtle px-4 py-3 -mx-1"
        style={{ background: shade ? "rgba(255,255,255,0.02)" : undefined }}>
        <div>
          <div className="flex items-center gap-2.5">
            {crest ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={crest} alt="" width={36} height={36} className="rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <PixelTeamLogo team={profile.team} size={30} />
            )}
            <h2 className="text-xl font-bold text-text-primary">{profile.name}</h2>
          </div>
          <p className="mt-1 text-xs text-text-dim">
            <TeamLine team={profile.team} teams={profile.teams} /> · {profile.bats ? `bats ${profile.bats}` : ""}{typeof profile.age === "number" ? ` · age ${Math.floor(profile.age)}` : ""} · {sampleLine}
          </p>
          <TeamSplitsDetails lines={(profile as any).teamSplits} cols={[["pa", "PA", 0], ["avg", "AVG", 3], ["obp", "OBP", 3], ["slg", "SLG", 3], ["woba", "wOBA", 3], ["hr", "HR", 0], ["kPct", "K%", 1], ["bbPct", "BB%", 1]]} />
        </div>
        <div className="flex flex-wrap gap-6 text-center">
          {[
            { label: "AVG", v: profile.avg },
            { label: "OBP", v: profile.obp },
            { label: "SLG", v: profile.slg },
            { label: "OPS", v: typeof profile.obp === "number" && typeof profile.slg === "number" ? Number((profile.obp + profile.slg).toFixed(3)) : null },
            { label: "ISO", v: typeof profile.avg === "number" && typeof profile.slg === "number" ? Number((profile.slg - profile.avg).toFixed(3)) : null },
            { label: "wOBA", v: profile.woba },
            { label: "K%", v: profile.kPct, pct: true },
          ].map(({ label, v, pct }: any) => (
            <div key={label}>
              <div className="font-data text-lg font-bold text-text-primary">
                {typeof v !== "number" ? "—" : pct ? `${v.toFixed(1)}%` : v.toFixed(3).replace(/^0/, "")}
              </div>
              <div className="text-[10px] text-text-dim">{label}</div>
              <div className="text-[10px] text-text-secondary">{headerRankText(label, v)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim">{DESCRIPTIVE_LINE}</span>
      </div>

      <ProfileTabs role="batter" value={tab} onChange={setTab} />
      <ProfileTabPanel role="batter" tab={tab}>
        {tab === "gamelog" ? (
          <GameLogPanel data={gameLog ?? null} playerId={playerId} season={profile.season} level={level} />
        ) : tab === "visuals" ? (
          <HitterVisualsTab visuals={visuals ?? null} explorer={{ id: String(playerId), season: profile.season, level }} />
        ) : tab === "swing" ? (
          <SwingTab swing={swing ?? null} name={profile.name} />
        ) : tab === "defense" ? (
          level === "aaa"
            ? <div className="glass-panel p-6 text-sm text-text-dim">Defense comes from MLB Statcast and Savant; there is no AAA version.</div>
            : <DefensePanel playerId={playerId} season={profile.season} />
        ) : tab === "savant" ? (
          <PercentilePanel peer={`Baseball Savant's published numbers, ${profile.season} · percentiles among the players Savant lists`} toggle={null}>
                <PercentileGroup title={<>Speed and baserunning <span className="font-normal text-text-dim">· Savant</span></>} rows={[
                  statRow("hitter", "sprintSpeed", "Sprint speed", profile.sprintSpeed, (v) => v.toFixed(2), seasonBp?.sprintSpeed),
                  statRow("hitter", "bsrRuns", "Baserunning runs", profile.bsrRuns, (v) => signedFixed(v, 2), seasonBp?.bsrRuns),
                  statRow("hitter", "xbRuns", "Extra bases", profile.xbRuns, (v) => signedFixed(v, 2), seasonBp?.xbRuns),
                  statRow("hitter", "sbRuns", "Stolen bases", profile.sbRuns, (v) => signedFixed(v, 2), seasonBp?.sbRuns),
                ]} />
                {running && (running.bsr || running.steal || running.xb || running.sprint) && (
                  <div className="glass-panel p-4 space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Baserunning detail</span>
                      <span className="text-[10px] text-text-dim">Savant · {running.season}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1.5 text-xs font-data">
                      {[
                        ["Bolts", running.sprint ? `${running.sprint.bolts} runs 30+ ft/s` : null],
                        ["Home → 1st", running.sprint && running.sprint.hp_to_1b != null ? `${Number(running.sprint.hp_to_1b).toFixed(2)}s` : null],
                        ["Competitive runs", running.sprint ? `${running.sprint.competitive_runs}` : null],
                        ["XB attempts", running.xb ? `${running.xb.attempts} of ${running.xb.opportunities} opps (${Math.round(100 * Number(running.xb.attempt_rate ?? 0))}%, league ${Math.round(100 * Number(running.xb.lg_attempt_rate ?? 0))}%)` : null],
                        ["Safe on XB", running.xb && running.xb.safe != null ? `${running.xb.safe} safe / ${running.xb.outs_made} out (${Math.round(100 * Number(running.xb.safe_rate ?? 0))}%)` : null],
                        ["Steal runs split", running.bsr ? `+${Number(running.bsr.xb_runs ?? 0).toFixed(1)} extra bases · +${Number(running.bsr.steal_runs ?? 0).toFixed(1)} steals (${running.bsr.times_moved} moves)` : null],
                        ["XB style", running.bsr && running.bsr.xb_swipe != null ? `swipe +${Number(running.bsr.xb_swipe).toFixed(1)} · snipe ${Number(running.bsr.xb_snipe ?? 0).toFixed(1)} · freeze ${Number(running.bsr.xb_freeze ?? 0).toFixed(1)}` : null],
                        ["Lead runs", running.steal ? `primary +${Number(running.steal.primary_lead_runs ?? 0).toFixed(1)} · secondary +${Number(running.steal.secondary_lead_runs ?? 0).toFixed(1)}` : null],
                        ["Steals", running.steal ? `${running.steal.sb} SB / ${running.steal.cs} CS${running.steal.sb_rate != null ? ` (${Math.round(100 * Number(running.steal.sb_rate))}%)` : ""}` : null],
                      ].filter(([, v]) => v != null).map(([label, v]) => (
                        <div key={String(label)}>
                          <div className="text-[9px] uppercase tracking-wider text-text-dim">{label}</div>
                          <div className="text-text-secondary">{v}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-text-dim">
                      Swipe = takes the extra base on a hit; snipe = advances on an out or error; freeze = holds where the
                      generic runner advances. Savant reference numbers, {running.season} rules — no model of ours.
                    </p>
                  </div>
                )}
                <PercentileGroup title={<>Fielding <span className="font-normal text-text-dim">· Savant{profile.oaaPos ? ` · ${profile.oaaPos}` : ""}</span></>} rows={[
                  statRow("hitter", "frvRuns", "Fielding run value", profile.frvRuns, (v) => signedFixed(v, 2), seasonBp?.frvRuns),
                  statRow("hitter", "oaa", "Outs above avg", profile.oaa, (v) => signedFixed(v, 0), seasonBp?.oaa),
                ]} />
                <PercentileGroup title={<>Catching <span className="font-normal text-text-dim">· Savant</span></>} rows={[
                  statRow("hitter", "framingRuns", "Framing runs", profile.framingRuns, (v) => signedFixed(v, 2), seasonBp?.framingRuns),
                  statRow("hitter", "blockingRuns", "Blocking runs", profile.blockingRuns, (v) => signedFixed(v, 2), seasonBp?.blockingRuns),
                  statRow("hitter", "throwingRuns", "Throwing runs", profile.throwingRuns, (v) => signedFixed(v, 2), seasonBp?.throwingRuns),
                  statRow("hitter", "popTime", "Pop time (2B)", profile.popTime, (v) => `${v.toFixed(2)}s`, seasonBp?.popTime),
                  statRow("hitter", "catcherArm", "Arm strength", profile.catcherArm, (v) => v.toFixed(2), seasonBp?.catcherArm),
                ]} />
          </PercentilePanel>
        ) : tab === "scouting" ? (
          <div className="space-y-5">
            <ZoneGridPanel data={scouting} league={scoutingLeague?.seasons?.[String(profile.season)]?.cells?.[profile.bats] ?? null} />
            <CountsPanel data={scouting} league={scoutingLeague?.seasons?.[String(profile.season)]?.counts ?? null} />
          </div>
        ) : tab === "approach" ? (
          <div className="space-y-5">
            <div className="glass-panel overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">vs handedness</span>
                <span className="text-[10px] text-text-dim">splits under 50 PA are leans, not rates</span>
              </div>
              {splitTable(vsHand, (v) => `vs ${v === "R" ? "RHP" : "LHP"}`, seasonBm?.hand)}
            </div>
            <div className="glass-panel overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">vs pitch family</span>
              </div>
              {splitTable(vsFamily, (v) => FAM_LABEL[v] ?? v, seasonBm?.family)}
            </div>
            <div className="glass-panel overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Pitches faced, by type</span>
                <span className="text-[10px] text-text-dim">the finer cut under the family splits</span>
              </div>
              <div className="overflow-x-auto"><div className="min-w-max">
                <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
                  <div className="w-[110px]">Type</div>
                  <div className="w-[56px] text-right">Seen</div>
                  <div className="w-[56px] text-right">PA</div>
                  <div className="w-[64px] text-right">Swing%</div>
                  <div className="w-[64px] text-right">Whiff%</div>
                  <div className="w-[56px] text-right">Lg whiff</div>
                  <div className="w-[64px] text-right">HH%</div>
                  <div className="w-[64px] text-right">Avg EV</div>
                </div>
                {faced.map((r) => {
                  const cfg = PITCH_CONFIG[r.t as keyof typeof PITCH_CONFIG];
                  const lgT = seasonBm?.type?.[r.t];
                  return (
                    <div key={r.t} className="flex items-center px-4 border-b border-white/[0.025]" style={{ height: "32px" }}
                      title={lgT ? `league vs ${r.t}: ${lgT.swingPct ?? "—"}% swung · ${lgT.whiffPct ?? "—"}% whiff` : undefined}>
                      <div className="w-[110px] flex items-center gap-1.5">
                        <div className="w-[3px] h-[14px] rounded-full" style={{ backgroundColor: cfg?.color }} />
                        <span className="text-xs font-medium text-text-primary">{cfg?.label ?? r.t}</span>
                      </div>
                      <div className="w-[56px] text-right text-xs font-data text-text-secondary">{r.n.toLocaleString("en-US")}</div>
                      <div className="w-[56px] text-right text-xs font-data text-text-dim">{r.pa}</div>
                      <div className="w-[64px] text-right text-xs font-data text-text-secondary">{r.swingPct ?? "—"}%</div>
                      <div className="w-[64px] text-right text-xs font-data text-text-primary">{r.whiffPct ?? "—"}%</div>
                      <div className="w-[56px] text-right text-xs font-data text-text-dim">{lgT?.whiffPct ?? "—"}</div>
                      <div className="w-[64px] text-right text-xs font-data text-text-secondary">{r.hardPct ?? "—"}%</div>
                      <div className="w-[64px] text-right text-xs font-data text-text-secondary">{r.avgEv ?? "—"}</div>
                    </div>
                  );
                })}
                {!faced.length && <p className="px-4 py-3 text-[11px] text-text-dim">No pitch-type data for this season.</p>}
              </div></div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <SeasonArc data={gameLog ?? null} />
            {seasonBp && (
              <PercentilePanel
                peer={`vs ${profile.season} MLB hitters (50+ PA) · ${sampleLine}`}
                toggle={null}
                banner={thinPa && (
                  <ThinSampleBanner>
                    Small sample: {sampleLine}. Rows need {PROFILE_PCT_FLOOR.bf} PA to fill in a percentile; below that
                    the rank still shows but hollow — dashed, with the sample under it.
                  </ThinSampleBanner>
                )}
                footer={
                  <AboutThis label="How to read these">
                    Each row is his rank among {profile.season} hitters with 50+ PA. Green is good for him, red bad
                    (a low K% ranks high). Hollow ranks are small samples, not verdicts. wOBA uses weights derived
                    from this site&apos;s own run data — descriptive, not a forecast of anything.
                  </AboutThis>
                }
              >
                <PercentileGroup title="Production" rows={[
                  statRow("hitter", "woba", "wOBA", profile.woba, dec3, seasonBp?.woba, thinPa),
                  statRow("hitter", "obp", "OBP", profile.obp, dec3, seasonBp?.obp, thinPa),
                  statRow("hitter", "slg", "SLG", profile.slg, dec3, seasonBp?.slg, thinPa),
                  statRow("hitter", "bbPct", "BB%", profile.bbPct, pct1, seasonBp?.bbPct, thinPa),
                  statRow("hitter", "kPct", "K%", profile.kPct, pct1, seasonBp?.kPct, thinPa),
                ]} />
                <PercentileGroup title="Contact quality" rows={[
                  statRow("hitter", "ev90", "EV90", profile.ev90, pct1, seasonBp?.ev90, bipThin),
                  statRow("hitter", "maxEv", "Max EV", profile.maxEv, pct1, seasonBp?.maxEv, bipThin),
                  statRow("hitter", "hardHitPct", "HH%", profile.hardHitPct, pct1, seasonBp?.hardHitPct, bipThin),
                  statRow("hitter", "barrelPct", "Brl%", profile.barrelPct, pct1, seasonBp?.barrelPct, bipThin),
                ]} />
                <PercentileGroup title="Discipline" rows={[
                  hDiscRow("oSwingPct", "O-Swg%"),
                  hDiscRow("whiffPct", "Whiff%"),
                  hDiscRow("contactPct", "Contact%"),
                  hDiscRow("swingPct", "Swing%"),
                  hDiscRow("firstPitchSwingPct", "1P-Swg%"),
                ]} />
                <PercentileGroup title="Expected (Statcast)" rows={[
                  statRow("hitter", "xwoba", "xwOBA", profile.xwoba, dec3, seasonBp?.xwoba, thinPa),
                  statRow("hitter", "xba", "xBA", profile.xba, dec3, seasonBp?.xba, thinPa),
                  statRow("hitter", "xslg", "xSLG", profile.xslg, dec3, seasonBp?.xslg, thinPa),
                  statRow("hitter", "xwobacon", "xwOBACON", profile.xwobacon, dec3, seasonBp?.xwobacon, bipThin),
                  statRow("hitter", "batRvPer100", "RV/100", profile.batRvPer100, (v) => signedFixed(v, 2), seasonBp?.batRvPer100, thinPa),
                ]} />
                <PercentileGroup title="Batted ball" rows={[
                  statRow("hitter", "sweetSpotPct", "Sweet-spot%", profile.sweetSpotPct, pct1, seasonBp?.sweetSpotPct, bipThin),
                  statRow("hitter", "pullAirPct", "Pull-air%", profile.pullAirPct, pct1, seasonBp?.pullAirPct, bipThin),
                  statRow("hitter", "pullPct", "Pull%", profile.pullPct, pct1, seasonBp?.pullPct, bipThin),
                  statRow("hitter", "laSd", "LA spread", profile.laSd, pct1, seasonBp?.laSd, bipThin),
                ]} />
                <PercentileGroup title="Swing (bat tracking)" rows={[
                  statRow("hitter", "batSpeed", "Bat speed", profile.batSpeed, pct1, seasonBp?.batSpeed),
                  statRow("hitter", "fastSwingPct", "Fast-swing%", profile.fastSwingPct, pct1, seasonBp?.fastSwingPct),
                  statRow("hitter", "squaredUpPct", "Squared-up%", profile.squaredUpPct, pct1, seasonBp?.squaredUpPct),
                  statRow("hitter", "blastPct", "Blast%", profile.blastPct, pct1, seasonBp?.blastPct),
                  statRow("hitter", "idealAaPct", "Ideal AA%", profile.idealAaPct, pct1, seasonBp?.idealAaPct),
                  statRow("hitter", "swingLength", "Swing length", profile.swingLength, (v) => v.toFixed(2), seasonBp?.swingLength),
                  statRow("hitter", "attackAngle", "Attack angle", profile.attackAngle, pct1, seasonBp?.attackAngle),
                ]} />
                <PercentileGroup title={<>Swing decisions <span className="font-normal text-text-dim">· descriptive</span></>} rows={[
                  statRow("hitter", "decisionPlus", "Decision+", profile.decisionPlus, (v) => v.toFixed(0), seasonBp?.decisionPlus, thinPa),
                  statRow("hitter", "drvPer100", "Decision runs/100", profile.drvPer100, (v) => signedFixed(v, 2), seasonBp?.drvPer100, thinPa),
                  statRow("hitter", "izaPer100", "In-zone", profile.izaPer100, (v) => signedFixed(v, 2), seasonBp?.izaPer100, thinPa),
                  statRow("hitter", "ozaPer100", "Out-of-zone", profile.ozaPer100, (v) => signedFixed(v, 2), seasonBp?.ozaPer100, thinPa),
                ]} />
              </PercentilePanel>
            )}

            {profile.wobaProj != null && (
              <div className="glass-panel p-4">
                <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Next-season projection (Marcel baseline)</h2>
                {([["wobaProj", "wOBA", dec3], ["kPctProj", "K%", pct1], ["bbPctProj", "BB%", pct1]] as const).map(([k, label, fmt]) => (
                  <ProjectionBand key={k} label={label} value={profile[k]} lo={profile[k + "Lo"]} hi={profile[k + "Hi"]}
                    bp={seasonBp?.[k]} fmt={fmt}
                    rank={seasonBp?.[k] && profile[k] != null ? getStatPercentileRank(k, profile[k], seasonBp[k]) : null} />
                ))}
                <p className="mt-1 text-[10px] text-text-dim">
                  Marcel: his last three seasons weighted 5/4/3, pulled toward league average by 1,200 PA; no age or park term (RESULTS-MLB §67).
                  Shaded: where 80% of past hitters with this much playing time actually landed. wOBA on Savant&apos;s scale.
                </p>
              </div>
            )}

            <a href={`/api/card/${playerId}?season=${profile.season}`} target="_blank" rel="noopener"
              className="inline-block text-[11px] text-text-dim underline-offset-2 hover:text-text-secondary hover:underline">
              Percentile card (PNG) ↗
            </a>

            <TrendPanel trend={profile.trend} role="hitter" />
            <RollingPanel trend={profile.trend} role="hitter" />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <LeagueScatter role="hitter" season={Number(profile.season)} id={String(playerId)} level={level} />
              <RvFamilyBars unit="Batting runs per 100 pitches seen" rows={[
                { label: "Fastballs", v: profile.batRvPer100Fb },
                { label: "Breaking", v: profile.batRvPer100Br },
                { label: "Offspeed", v: profile.batRvPer100Os },
              ]} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="glass-panel p-4">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Batted ball</h2>
                <div className="space-y-1.5">
                  {(["gbPct", "ldPct", "fbPct", "puPct"] as const).map((k) => {
                    const v = profile[k];
                    const label = { gbPct: "Ground ball", ldPct: "Line drive", fbPct: "Fly ball", puPct: "Pop-up" }[k];
                    return (
                      <div key={k} className="flex items-center gap-2 text-[11px]">
                        <span className="w-[80px] text-text-secondary">{label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          {typeof v === "number" && <div className="h-full bg-text-secondary/60" style={{ width: `${Math.max(2, v)}%` }} />}
                        </div>
                        <span className="w-[44px] text-right font-data text-text-dim">{typeof v === "number" ? `${v.toFixed(1)}%` : "—"}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-text-dim">
                  Avg EV {profile.avgEv ?? "—"} mph · avg LA {profile.avgLa ?? "—"}° · {profile.nBip ?? 0} balls in play.
                  {typeof profile.nBip === "number" && profile.nBip < 50 ? " Thin BIP sample — the quality rows are leans." : ""}
                </p>
              </div>

              <SprayPanel data={spray} refs={sprayRefs} season={profile.season} bats={profile.bats} />
              <ScoutingCard data={scouting} />
              <div className="glass-panel p-4">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">What this profile is</h2>
                <p className="text-[11px] leading-relaxed text-text-secondary">
                  Measured production, contact quality and discipline for {profile.season}. The model layer — expected
                  wOBA, decision grades, park adjustments — is not built yet; until then the Savant expected-stats
                  board carries that side with attribution. Nothing here projects next season.
                </p>
              </div>
            </div>
          </div>
        )}
      </ProfileTabPanel>
      {tab === "overview" && agingStrip}
      <span className="hidden">{playerId}</span>
    </div>
  );
}
