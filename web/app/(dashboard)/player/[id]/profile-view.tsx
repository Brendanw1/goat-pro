"use client";

/**
 * Pitcher profile, MVP surface per docs/parity-matrix.md: summary header (PP1),
 * arsenal raw rows (PP2) + per-class stuff/pitching grades (PP3), batted-ball
 * against (PP6), movement + release (PP7), VAA (PP8), the arm-slot file (PP13)
 * and the 3D stuff lab. Loc+/xRV/RV/tunnels/tagger/game-plan panels are
 * NEEDS-MODEL and deleted, not stubbed. Every grade renders under the
 * descriptive label (model card gate_status `descriptive-only`).
 */
import { useState } from "react";
import Link from "next/link";
import { PITCH_CONFIG } from "@/lib/constants";
import { MovementPlot } from "@/components/charts/movement-plot";
import { ExpandableCard } from "@/components/ui/expandable-card";
import { VAAGrid } from "@/components/charts/vaa-grid";
import { PROFILE_PCT_FLOOR, GRADE_PCT_FLOOR, NEUTRAL_GREY, percentileColor, getPitcherPercentileRank } from "@/lib/percentiles";import { HeaderStat, PercentileGroup, PercentilePanel, ThinSampleBanner, statRow, type PctRow } from "@/components/ui/percentile-row";
import { AboutThis } from "@/components/ui/discipline-block";
import { ProfileTabs, ProfileTabPanel } from "@/components/ui/profile-tabs";
import { GradePct, gradedN } from "@/components/ui/grade-pct";
import { DynamicStuffLab } from "@/components/3d/lab-dynamic";
import { SharedGradeNote, GyroTag } from "@/components/ui/shared-grade-note";
import { PitcherVisualsTab } from "@/components/ui/visuals-tab";
import { CareerArsenal } from "@/components/ui/career-arsenal";
import { baseCode, type PitchType, MovementPoint, ReleasePoint } from "@/types";
import { DescriptiveChip, DESCRIPTIVE_LINE, PITCHING_TIP, K_TIP, PREVENTION_TIP, CONTROL_TIP, STUFF_TIP, gradeColor, confidenceBadge } from "@/lib/grades";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { logoUrl, teamPixels } from "@/lib/team-pixel";
import { signedFixed, PctChip } from "@/components/ui/shared-ui";
import { PitchRvCard } from "@/components/ui/pitch-rv-card";
import { GameLogPanel } from "@/components/ui/game-log-panel";
import { SituationalRunsPanel } from "@/components/ui/situational-runs-panel";
import { LocationMixPanel } from "@/components/ui/location-mix-panel";
import { ArsenalOverview } from "@/components/ui/arsenal-overview";
import { RV100_TIP } from "@/lib/rv-cells";
import { TrendPanel } from "@/components/ui/trend-panel";
import { ProjectionBand, LeagueScatter } from "@/components/ui/league-views";

const int0 = (v: number) => Math.round(v).toString();
const pct1 = (v: number) => v.toFixed(1) + "%";
const dec2 = (v: number) => v.toFixed(2);
const signed2 = (v: number) => (v > 0 ? "+" : "") + v.toFixed(2);
const dec3 = (v: number) => v.toFixed(3).replace(/^0/, "");

/** Balls in play below which a batted-ball row renders dim (marked thin, never dropped). */
const THIN_BIP = 5;

type ProfileViewProps = {
  /** Where "← Back" goes: the MLB board, or /minors on an AAA profile. */
  backHref?: string;
  profile: any;
  percentiles?: any;
  playerId: string;
  slot?: any | null;
  vaaPct?: Record<string, PctRow[]>;
  vaaSeason?: string;
  pitchRv?: any | null;
  zoneMix?: any | null;
  gameLog?: any | null;
  visuals?: any | null;
  career?: any | null;
  careerArsenal?: any[] | null;
  level?: string;
  situational?: any | null;
};

/** A pitch's VAA cells tinted by their same-zone rank: verdict colour, or grey when the row is descriptive. */
function vaaTints(rows: PctRow[] | undefined): Record<string, string> | undefined {
  if (!rows) return undefined;
  return Object.fromEntries(rows.filter((r) => r.rank !== null && r.floor === undefined).map((r) => [r.key, `${r.neutral ? NEUTRAL_GREY : percentileColor(r.rank!)}59`]));
}

/** Per-pitch-type percentiles: one pitch at a time, ranked against that pitch type. */
function PitchTypePercentiles({ rows, perTypeBp, active, onPick }: {
  rows: any[]; perTypeBp: any; active: string | null; onPick: (pt: string) => void;
}) {
  const code = (p: any) => (p.pitchType || "FF") as string;
  const activePt = active || code(rows[0]);
  const pitch = rows.find((p) => code(p) === activePt);
  const ptBp = perTypeBp?.[baseCode(activePt)] || null;
  const n = pitch ? (pitch.n_pitches ?? pitch.nPitches) : null;
  // A pitch type under the per-type grade floor shows its count instead of ranks, like every grade chip on the site.
  const thin = typeof n === "number" && n < GRADE_PCT_FLOOR.type ? { n, unit: "thrown", floor: GRADE_PCT_FLOOR.type } : null;
  return (
    <section className="glass-panel p-4 shadow-[0_6px_24px_rgba(0,0,0,0.3)]" aria-label="Percentiles by pitch type">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Percentiles by pitch type</h2>
          <p className="mt-0.5 text-[11px] text-text-secondary">
            Each pitch against the same pitch type{typeof n === "number" ? ` · ${n.toLocaleString()} thrown` : ""}
            {typeof n === "number" && n < GRADE_PCT_FLOOR.type ? " (ranks hollow under 50)" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Pitch type">
          {rows.map((p) => {
            const pt = code(p) as PitchType;
            const cfg = PITCH_CONFIG[pt] || PITCH_CONFIG.FF;
            const on = pt === activePt;
            return (
              <button key={pt} type="button" aria-pressed={on} onClick={() => onPick(pt)}
                className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors ${on ? "border-white/[0.15] bg-white/[0.08] text-text-primary" : "border-border-subtle text-text-dim hover:bg-white/[0.05]"}`}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: cfg.color }} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>
      {!pitch || !ptBp ? (
        <p className="text-[11px] text-text-dim">No breakpoints for this pitch type.</p>
      ) : (
        <div className="columns-1 gap-8 md:columns-2">
          <PercentileGroup title="Shape" rows={[
            statRow("pitcher", "velo", "Velo", pitch.velo, (v) => v.toFixed(1), ptBp.velo, thin),
            statRow("pitcher", "ivb", "IVB (abs)", pitch.ivb != null ? Math.abs(pitch.ivb) : null, (v) => v.toFixed(1), ptBp.ivb, thin),
            statRow("pitcher", "hb", "HB (abs)", pitch.hb != null ? Math.abs(pitch.hb) : null, (v) => v.toFixed(1), ptBp.hb, thin),
            statRow("pitcher", "spin", "Spin", pitch.spin, int0, ptBp.spin, thin),
          ]} />
          <PercentileGroup title="Grades and results" rows={[
            statRow("pitcher", "stuffPlus", "Stuff+", pitch.stuffPlus, int0, ptBp.stuffPlus, thin),
            statRow("pitcher", "whiffPct", "Whiff%", pitch.whiffPct, pct1, ptBp.whiffPct, thin),
            statRow("pitcher", "cswPct", "CSW%", pitch.cswPct, pct1, ptBp.cswPct, thin),
            statRow("pitcher", "zonePct", "Zone%", pitch.zonePct, pct1, ptBp.zonePct, thin),
          ]} />
        </div>
      )}
    </section>
  );
}

/**
 * The arm-slot file (PP13): per-type release and shape rows. Every comparable
 * number carries its percentile chip so pitchers scan side by side: arm° vs
 * the league's arm angles for that type, velo/IVB/HB/spin vs this season's
 * same-type population, and the Δ columns vs his own slot band (the bake
 * ranks them within type × band). The Δ chips are two-sided — a high chip is
 * "well above what his slot throws", a low one "well below" — a scouting
 * fact, not a verdict, so the delta value tints only when it clearly stands out.
 */
const STANDOUT_PCT = 85;

function ArmSlotFile({ slot, perTypeBp, season }: { slot: any; perTypeBp?: any; season?: number }) {
  const rows = (slot?.types ?? []) as any[];
  if (!rows.length) return null;
  // Per-type season pools rank only when the slot file is the profile's season.
  const sameSeason = season === undefined || slot?.season === season;
  const typeRank = (r: any, metric: "velo" | "ivb" | "hb"): number | null => {
    const v = r?.[metric];
    const bp = perTypeBp?.[r.type]?.[metric];
    if (!sameSeason || typeof v !== "number" || !bp) return null;
    return getPitcherPercentileRank(metric, v, bp);
  };
  const pctChip = (pct: number | null | undefined, title: string) =>
    typeof pct === "number" && Number.isFinite(pct) ? <PctChip p={pct} title={`${Math.round(pct)}th — ${title}`} /> : null;
  // Δ columns: the chip shows the two-sided rank; the value tints when it clearly
  // stands out from his slot band (the "more movement than expected" scan).
  const deltaCell = (value: number | null | undefined, pct: number | null | undefined, what: string) => {
    const p = typeof pct === "number" ? pct : null;
    const stands = p !== null && (p >= STANDOUT_PCT || p <= 100 - STANDOUT_PCT);
    return (
      <>
        <span className="font-data" style={stands && p !== null ? { color: percentileColor(p), fontWeight: 600 } : undefined}>
          {signedFixed(value, 1)}
        </span>
        {pctChip(p, `of his slot band's ${what}s (${stands ? "stands out from the band" : "within the band's range"})`)}
      </>
    );
  };
  // The read: up to two clearest standouts, in coach language.
  const standouts = rows
    .flatMap((r) => {
      const out: { text: string; dist: number }[] = [];
      if (typeof r.dIvbPct === "number" && (r.dIvbPct >= STANDOUT_PCT || r.dIvbPct <= 100 - STANDOUT_PCT) && typeof r.dIvb === "number") {
        const above = r.dIvbPct >= 50;
        out.push({ dist: Math.abs(r.dIvbPct - 50), text: `${r.type} carries ${Math.abs(r.dIvb).toFixed(1)}" ${above ? "more" : "less"} IVB than his slot's typical (${r.dIvbPct}th)` });
      }
      if (typeof r.dHbPct === "number" && (r.dHbPct >= STANDOUT_PCT || r.dHbPct <= 100 - STANDOUT_PCT) && typeof r.dHb === "number") {
        const above = r.dHbPct >= 50;
        out.push({ dist: Math.abs(r.dHbPct - 50), text: `${r.type} sits ${Math.abs(r.dHb).toFixed(1)}" ${above ? "arm-side" : "glove-side"} of his slot's typical HB (${r.dHbPct}th)` });
      }
      return out;
    })
    .sort((a, b) => b.dist - a.dist)
    .slice(0, 2);
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Arm-slot file</span>
        <span className="text-[10px] text-text-dim">Descriptive: arm angle, release, shape. Chips rank him — arm° vs the league's arm angles for the type, velo/shape vs this season's same-type pitchers, Δ vs his own slot band. Not a grade.</span>
      </div>
      {standouts.length > 0 && (
        <p className="px-4 py-2 text-xs leading-relaxed text-text-secondary border-b border-border-subtle" aria-label="What stands out from his slot">
          vs his slot's pitchers: {standouts.map((s) => s.text).join("; ")}.
        </p>
      )}
      <div className="overflow-x-auto"><div className="min-w-max">
        <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
          <div className="w-[50px]">Pitch</div>
          <div className="w-[40px] text-right">N</div>
          <div className="w-[74px] text-right">Arm°</div>
          <div className="w-[74px] text-right">Velo</div>
          <div className="w-[74px] text-right">IVB</div>
          <div className="w-[74px] text-right">HB</div>
          <div className="w-[74px] text-right">Spin</div>
          <div className="w-[48px] text-right">RelH</div>
          <div className="w-[48px] text-right">RelS</div>
          <div className="w-[44px] text-right">Ext</div>
          <div className="w-[84px] text-right" title="His IVB minus what pitchers from his arm slot throw for this type; chip = rank within his slot band">ΔIVB</div>
          <div className="w-[84px] text-right" title="His arm-side HB minus his slot's expectation; chip = rank within his slot band">ΔHB</div>
        </div>
        {rows.map((r) => {
          const pt = (r.type || "FF") as PitchType;
          const config = PITCH_CONFIG[pt] || PITCH_CONFIG.FF;
          const f1 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—");
          const typeNoun = PITCH_CONFIG[pt]?.label || pt;
          return (
            <div key={r.type} className="flex items-center px-4 border-b border-white/[0.025]" style={{ height: "34px" }}>
              <div className="w-[50px] flex items-center gap-1.5">
                <div className="w-[3px] h-[14px] rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-xs font-medium text-text-primary">{config.shortLabel}</span>
              </div>
              <div className="w-[40px] text-right text-xs font-data text-text-secondary">{r.n}</div>
              <div className="w-[74px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary">
                {f1(r.arm)}{pctChip(r.armPct, `of the league's ${typeNoun} arm angles`)}
              </div>
              <div className="w-[74px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary" title={sameSeason ? undefined : "Season percentiles need the slot file's season — open this season's profile"}>
                {f1(r.velo)}
                {sameSeason && typeRank(r, "velo") !== null && <PctChip p={typeRank(r, "velo")!} title={`among this season's ${typeNoun}s`} />}
              </div>
              <div className="w-[74px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary">
                {f1(r.ivb)}
                {sameSeason && typeRank(r, "ivb") !== null && <PctChip p={typeRank(r, "ivb")!} title={`among this season's ${typeNoun}s (signed IVB)`} />}
              </div>
              <div className="w-[74px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary">
                {f1(r.hb)}
                {sameSeason && typeRank(r, "hb") !== null && <PctChip p={typeRank(r, "hb")!} title={`among this season's ${typeNoun}s (signed HB)`} />}
              </div>
              <div className="w-[74px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary">
                {typeof r.spin === "number" ? Math.round(r.spin) : "—"}
                {sameSeason && perTypeBp?.[r.type]?.spin && typeof r.spin === "number" && (
                  <PctChip p={getPitcherPercentileRank("spin", r.spin, perTypeBp[r.type].spin)} title={`among this season's ${typeNoun}s`} />
                )}
              </div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{f1(r.relH)}</div>
              <div className="w-[48px] text-right text-xs font-data text-text-secondary">{f1(r.relS)}</div>
              <div className="w-[44px] text-right text-xs font-data text-text-secondary">{f1(r.ext)}</div>
              <div className="w-[84px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary">{deltaCell(r.dIvb, r.dIvbPct, "IVB")}</div>
              <div className="w-[84px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary">{deltaCell(r.dHb, r.dHbPct, "HB")}</div>
            </div>
          );
        })}
      </div></div>
    </div>
  );
}

const PLATOON_TIP = "Whiff+ of this pitch vs left- / right-handed hitters (shrunk toward its overall grade), with usage vs that hand. Both hands share one scale, so the usual same-side edge shows. Descriptive: the observed whiff split forecast next season's split better than this one (RESULTS-MLB §73).";

/** Shrunk per-hand Whiff+ over usage vs that hand; neutral colour, since §73 did not confirm it as a forecast. */
function PlatoonCell({ pitch, h }: { pitch: any; h: "LHH" | "RHH" }) {
  const v = pitch[`stuffVs${h}Shrunk`];
  if (typeof v !== "number") return <div className="w-[76px] text-right text-xs text-text-dim">—</div>;
  const tip = `Raw ${pitch[`stuffVs${h}`]} (95% CI ${pitch[`stuffVs${h}Lo`]}–${pitch[`stuffVs${h}Hi`]}) on ${pitch[`nVs${h}`]} pitches`;
  return (
    <div className="w-[76px] text-right text-xs font-data leading-tight text-text-secondary" title={tip}>
      {Math.round(v)}
      <span className="block text-[9px] text-text-dim">{pitch[`usageVs${h}`]?.toFixed(1)}% use</span>
    </div>
  );
}

export function PlayerProfileView({ profile, percentiles, playerId, slot, vaaPct, vaaSeason, pitchRv, zoneMix, gameLog, situational, visuals, career, careerArsenal, backHref = "/pitchers", level }: ProfileViewProps) {
  const [vaaPitchFilter, setVaaPitchFilter] = useState<string>("all");
  const [percentilePitchTab, setPercentilePitchTab] = useState<string | null>(null);
  const [tab, setTab] = useState<any>("overview");
  const pitches = profile.pitches || [];
  const rows = pitches;

  const pitcherBp = percentiles?.pitchers ?? null;
  const perTypeBp = percentiles?.pitchers_per_type ?? null;
  const totalPitches = pitches.reduce((a: number, p: any) => a + (p.n_pitches ?? p.nPitches ?? 0), 0);
  const sampleLine = [
    typeof profile.ip === "number" ? `${profile.ip.toFixed(1)} IP` : null,
    typeof profile.battersFaced === "number" ? `${profile.battersFaced.toLocaleString("en-US")} BF` : null,
    totalPitches > 0 ? `${totalPitches.toLocaleString("en-US")} pitches` : null,
    typeof profile.season === "number" ? `${profile.season} season` : null,
  ].filter(Boolean).join(" · ");
  const peerLine = `vs ${profile.season ?? ""} graded MLB pitchers · ${sampleLine}`;
  // Under the profile floor a row keeps its rank but drawn hollow (the small-sample
  // state) with the sample under it — comparable, never filled in until the floor.
  const bf = typeof profile.battersFaced === "number" ? profile.battersFaced : null;
  const thinBf = bf !== null && bf < PROFILE_PCT_FLOOR.bf ? { n: bf, unit: "BF", floor: PROFILE_PCT_FLOOR.bf } : null;
  const thinGrade = totalPitches < PROFILE_PCT_FLOOR.pitches ? { n: totalPitches, unit: "pitches", floor: PROFILE_PCT_FLOOR.pitches } : null;
  const GRADE_KEYS = new Set(["stuffPlus", "pitchingPlus", "kPlus", "preventionPlus", "controlPlus", "kProj", "pitchingRunsPer100"]);
  /**
   * A discipline panel row: the RAW rate prints; the rank comes from the
   * sample-adjusted twin against the season's shrunk population (both from
   * the bake). Falls back to the raw rate against the raw population when
   * either twin or population is missing.
   */
  const shrunkBp = (percentiles as any)?.shrunk_by_season?.[String(profile.season)] ?? null;
  const discRow = (key: string, label: string, prof: any) => {
    const twin = prof?.[`${key}Shrunk`];
    const useShrunk = typeof twin === "number" && shrunkBp?.[key];
    return statRow(
      "pitcher", key, label,
      useShrunk ? twin : prof?.[key],
      pct1,
      useShrunk ? shrunkBp[key] : pitcherBp?.[key],
      thinBf,
      useShrunk ? `${key}Shrunk` : key,
      useShrunk ? (typeof prof?.[key] === "number" ? `${(prof[key] as number).toFixed(1)}%` : undefined) : undefined,
    );
  };

  /** A header number's rank: the same number the panel row shows, suppressed below the floor (the dot has no hollow state). */
  const headerRank = (key: string, v: number): number | null => {
    const row = statRow("pitcher", key, key, v, String, pitcherBp?.[key], GRADE_KEYS.has(key) ? thinGrade : thinBf);
    return row && row.floor === undefined ? row.rank ?? null : null;
  };

  /** release[0], not release — the export publishes an array of one (R toJSON), so index it. */
  const release: ReleasePoint = (Array.isArray(profile.release) ? profile.release[0] : profile.release) || {};
  const battedBall = profile.battedBall || [];
  const vaaByZone = profile.vaaByZone || null;
  const vaaByPitch = profile.vaaByPitch || [];

  const movementProfile: MovementPoint[] =
    profile.movementProfile ||
    pitches.map((p: any) => ({
      pitchType: (p.pitchType || "FF") as PitchType,
      ivb: p.ivb || 0,
      hb: p.hb || 0,
    }));

  const orderedBattedBall = [...battedBall].sort(
    (a: any, b: any) => (b.n_bip || b.nBip || 0) - (a.n_bip || a.nBip || 0),
  );

  const hasPlatoon = rows.some((p: any) => typeof p.stuffVsLHHShrunk === "number" || typeof p.stuffVsRHHShrunk === "number");

  /** The pitch table. `compact` is the Overview's version beside the movement plot; the Arsenal tab carries every column. */
  const arsenalCard = (compact: boolean) => (
    <div className="glass-panel overflow-hidden" data-glow="fastball">
      <div className="px-4 py-2.5 border-b border-border-subtle flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Arsenal</span>
        {compact && <span className="text-[10px] text-text-dim">Key columns; every column is on the Arsenal tab</span>}
      </div>
      <div className="overlay-swap">
        {/* Scrolls inside the card on a phone instead of squeezing the columns together; Pitch stays pinned. */}
        <div className="overflow-x-auto"><div className="min-w-max">
          <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
            <div className="w-[50px] sticky-col">Pitch</div>
            <div className="w-[40px] text-right" title="Pitches of this type">N</div>
            <div className="w-[48px] text-right">Usage</div>
            <div className="w-[44px] text-right">Velo</div>
            <div className="w-[40px] text-right">IVB</div>
            <div className="w-[40px] text-right">HB</div>
            <div className="w-[44px] text-right">Spin</div>
            {!compact && <div className="w-[40px] text-right" title="Extension (ft)">Ext</div>}
            <div className="w-[52px] text-right text-usf-gold">Whiff%</div>
            <div className="w-[48px] text-right">CSW%</div>
            <div className="w-[48px] text-right">Zone%</div>
            <div className="w-[52px] text-right">Chase%</div>
            <div className="w-[100px] text-right text-usf-gold" title={STUFF_TIP}>Whiff+</div>
            {!compact && <div className="w-[84px] text-right" title={PITCHING_TIP}>Pitching+</div>}
            {!compact && <div className="w-[54px] text-right" title={RV100_TIP}>RV/100</div>}
            {!compact && hasPlatoon && <div className="w-[76px] text-right" title={PLATOON_TIP}>vs LHH</div>}
            {!compact && hasPlatoon && <div className="w-[76px] text-right" title={PLATOON_TIP}>vs RHH</div>}
          </div>
          {rows.map((pitch: any, i: number) => {
            const pt = pitch.pitchType || "FF";
            const config = PITCH_CONFIG[pt as PitchType] || PITCH_CONFIG.FF;
            const gradeCell = (value: unknown, metric: string) => (
              <>
                {typeof value === "number" && !isNaN(value) ? (
                  <>
                    <span className="font-medium" style={{ color: gradeColor(value as number) }}>
                      {Math.round(value as number)}
                    </span>
                    <GradePct metric={metric} value={value as number} n={gradedN(pitch)} code={pt} season={profile.season} />
                    {pitch.stuffGradeFrom && metric === "stuffPlus" && (
                      <span className="block text-[9px] text-text-dim" title={`Graded with the ${pitch.stuffGradeFrom} class model; the class grade is shared by every type in it`}>
                        {pitch.stuffGradeFrom} class
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-text-dim">—</span>
                )}
              </>
            );
            return (
              <div
                key={pt}
                className={`flex items-center px-4 border-b border-white/[0.025] ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`}
                style={{ height: "38px" }}
              >
                <div className="w-[50px] flex items-center gap-1.5 sticky-col self-stretch" title={pitch.gyro ? "Gyro slider — bullet-spin slider (gyro share ≥ 75%)" : undefined}>
                  <div className="w-[3px] h-[16px] rounded-full" style={{ backgroundColor: config.color }} />
                  <span className="text-xs font-medium text-text-primary leading-tight">{config.shortLabel}</span>
                  {pitch.gyro ? <GyroTag /> : null}
                </div>
                <div className="w-[40px] text-right text-xs font-data text-text-secondary">{(pitch.n_pitches ?? pitch.nPitches)?.toLocaleString("en-US") ?? "—"}</div>
                <div className="w-[48px] text-right text-xs font-data text-text-secondary">{pitch.usage?.toFixed(1)}%</div>
                <div className="w-[44px] text-right text-xs font-data text-text-secondary">{pitch.velo?.toFixed(1)}</div>
                <div className="w-[40px] text-right text-xs font-data text-text-secondary">{pitch.ivb?.toFixed(1)}</div>
                <div className="w-[40px] text-right text-xs font-data text-text-secondary">{pitch.hb?.toFixed(1)}</div>
                <div className="w-[44px] text-right text-xs font-data text-text-secondary">{Math.round(pitch.spin || 0)}</div>
                {!compact && <div className="w-[40px] text-right text-xs font-data text-text-secondary">{typeof pitch.ext === "number" ? pitch.ext.toFixed(1) : "—"}</div>}
                <div className="w-[52px] text-right text-xs font-data font-medium" style={{ color: config.color }}>
                  {pitch.whiffPct?.toFixed(1)}%
                </div>
                <div className="w-[48px] text-right text-xs font-data text-text-secondary">{pitch.cswPct?.toFixed(1)}%</div>
                <div className="w-[48px] text-right text-xs font-data text-text-secondary">{pitch.zonePct?.toFixed(1)}%</div>
                <div className="w-[52px] text-right text-xs font-data text-text-secondary">{pitch.chasePct?.toFixed(1)}%</div>
                <div className="w-[100px] text-right text-xs font-data leading-tight" title={STUFF_TIP}>
                  {gradeCell(pitch.stuffPlus, "stuffPlus")}
                </div>
                {!compact && (
                  <div className="w-[84px] text-right text-xs font-data leading-tight" title={PITCHING_TIP}>
                    {gradeCell(pitch.pitchingPlus, "pitchingPlus")}
                  </div>
                )}
                {!compact && (
                  <div className="w-[54px] text-right text-xs font-data text-text-secondary" title={RV100_TIP}>
                    {typeof pitch.rv100 === "number" && Number.isFinite(pitch.rv100) ? signed2(pitch.rv100) : "—"}
                  </div>
                )}
                {!compact && hasPlatoon && (["LHH", "RHH"] as const).map((h) => <PlatoonCell key={h} pitch={pitch} h={h} />)}
              </div>
            );
          })}
        </div></div>
        {/* Sits inside the arsenal panel on purpose: it is a caveat about the
            rows directly above it, not a finding of its own. */}
        <SharedGradeNote pitches={rows} />
        {(() => {
          const twins = rows.filter((p: any) => p.twin?.n);
          if (!twins.length) return null;
          return (
            <div className="px-4 py-2.5 border-t border-border-subtle">
              <p className="text-[10px] leading-relaxed text-text-dim">
                Shaped nearest to, among every qualified MLB pitch of the same type that season:{" "}
                {twins.map((p: any, i: number) => (
                  <span key={p.pitchType}>
                    {i > 0 && "; "}
                    <span className="font-data text-text-secondary">{p.pitchType}</span> ≈{" "}
                    <Link href={`/player/${p.twin.id}?season=${p.twin.s}`} className="text-text-secondary hover:underline">
                      {p.twin.n}
                    </Link>
                    <span className="text-text-dim">
                      {" "}({p.twin.dv[0] > 0 ? "+" : ""}{p.twin.dv[0]} mph, {p.twin.dv[1] > 0 ? "+" : ""}{p.twin.dv[1]}" IVB, {p.twin.dv[2] > 0 ? "+" : ""}{p.twin.dv[2]}" HB)
                    </span>
                  </span>
                ))}
                . A reference point for the eye, not a claim — the shape is his neighbour&apos;s, the results are his own.
              </p>
            </div>
          );
        })()}
      </div>
    </div>
  );

  const badge = confidenceBadge(profile.confidence);

  const shade = (() => {
    const px = teamPixels(profile.team);
    return px
      ? `radial-gradient(90% 60% at 12% 0%, ${px.bg}38 0%, transparent 62%), radial-gradient(70% 50% at 95% 8%, ${px.ink}1A 0%, transparent 55%)`
      : undefined;
  })();

  return (
    /* The club colour owns the whole page: a fixed-attachment radial so the
       shade stays put while the page scrolls, over the dark ground. */
    <div
      className="space-y-5 -m-2 p-2"
      style={{
        background: shade,
        backgroundAttachment: "fixed",
        minHeight: "100vh",
      }}
    >
      {/* Header: identity + sample on the left, the headline numbers on the right.
          The band keeps a slightly stronger wash of the same colours; the crest
          is the club's real cap logo, with the pixel badge as the fallback. */}
      <div
        className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border border-border-subtle px-4 py-3 -mx-1"
        style={{
          background: (() => {
            const px = teamPixels(profile.team);
            return px ? `radial-gradient(120% 160% at 0% 0%, ${px.bg}2E 0%, transparent 62%), radial-gradient(90% 140% at 100% 100%, ${px.ink}14 0%, transparent 55%)` : undefined;
          })(),
        }}
      >
        <div className="flex items-start gap-4">
          {(() => {
            const url = logoUrl(profile.team);
            return url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`${profile.team} logo`} width={56} height={56} className="h-14 w-14 object-contain" />
            ) : (
              <PixelTeamLogo team={profile.team} size={44} />
            );
          })()}
          <Link
            href={backHref}
            className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.05] border border-border-subtle text-text-secondary hover:bg-white/[0.08] hover:border-white/[0.15] active:scale-[0.95] transition-all duration-150"
          >
            ← Back
          </Link>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold text-text-primary">
              {!logoUrl(profile.team) && <PixelTeamLogo team={profile.team} size={26} />}
              {profile.name}
            </h1>
            <p className="mt-0.5 text-xs text-text-secondary">
              {profile.team} · {profile.throws === "L" || profile.throws === "Left" ? "LHP" : "RHP"}{typeof profile.age === "number" ? ` · age ${Math.floor(profile.age)}` : ""}
              {typeof profile.season === "number" ? ` · ${profile.season}` : ""}
            </p>
            <p className="mt-0.5 font-data text-[11px] text-text-dim">{sampleLine}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {badge && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${badge.bg} ${badge.text}`}>
                  {badge.label}
                </span>
              )}
              <DescriptiveChip />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
          {/* Grades. Values stay white; the rank sits under them like every other number. */}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            {[
              { label: "Whiff+", key: "stuffPlus", value: profile.stuffPlus, tip: STUFF_TIP },
              { label: "K+", key: "kPlus", value: profile.kPlus, tip: K_TIP },
              { label: "Prevention+", key: "preventionPlus", value: profile.preventionPlus, tip: PREVENTION_TIP },
              { label: "Control+", key: "controlPlus", value: profile.controlPlus, tip: CONTROL_TIP },
              { label: "Pitching+", key: "pitchingPlus", value: profile.pitchingPlus, tip: PITCHING_TIP },
            ].filter((g) => typeof g.value === "number" && !isNaN(g.value)).map((g) => (
              <HeaderStat key={g.key} label={g.label} value={Math.round(g.value).toString()} title={g.tip}
                rank={headerRank(g.key, g.value)} />
            ))}
          </div>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            {[
              { key: "kPct", label: "K%", value: profile.kPct, fmt: (v: number) => v.toFixed(1) + "%" },
              { key: "bbPct", label: "BB%", value: profile.bbPct, fmt: (v: number) => v.toFixed(1) + "%" },
              { key: "fip", label: "FIP", value: profile.fip, fmt: (v: number) => v.toFixed(2) },
            ].filter((x) => typeof x.value === "number" && !isNaN(x.value)).map((x) => (
              <HeaderStat key={x.key} label={x.label} value={x.fmt(x.value)} rank={headerRank(x.key, x.value)} />
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-text-dim">{DESCRIPTIVE_LINE}</p>

      {/* Tabs: Overview · Arsenal. */}
      <ProfileTabs role="pitcher" value={tab} onChange={setTab} />

      <ProfileTabPanel role="pitcher" tab={tab}>
      {tab === "visuals" ? (
          <PitcherVisualsTab visuals={visuals ?? null} career={career} />
        ) : tab === "gamelog" ? (
          <GameLogPanel data={gameLog ?? null} playerId={playerId} season={profile.season} level={level} />
        ) : tab === "arsenal" ? (
        <div className="space-y-5">
          {careerArsenal && careerArsenal.length > 0 && <CareerArsenal seasons={careerArsenal} />}
          {/* Every model grade in one strip, so the Arsenal tab carries the whole model read. */}
          <div className="glass-panel px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Model grades</div>
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
              {[
                { label: "Whiff+", key: "stuffPlus", value: profile.stuffPlus, tip: STUFF_TIP, fmt: (v: number) => Math.round(v).toString() },
                { label: "K+", key: "kPlus", value: profile.kPlus, tip: K_TIP, fmt: (v: number) => Math.round(v).toString() },
                { label: "Prevention+", key: "preventionPlus", value: profile.preventionPlus, tip: PREVENTION_TIP, fmt: (v: number) => Math.round(v).toString() },
                { label: "Control+", key: "controlPlus", value: profile.controlPlus, tip: CONTROL_TIP, fmt: (v: number) => Math.round(v).toString() },
                { label: "Pitching+", key: "pitchingPlus", value: profile.pitchingPlus, tip: PITCHING_TIP, fmt: (v: number) => Math.round(v).toString() },
                { label: "K proj", key: "kProj", value: profile.kProj, tip: K_TIP, fmt: (v: number) => v.toFixed(3).replace(/^0/, "") },
                { label: "Runs+/100", key: "pitchingRunsPer100", value: profile.pitchingRunsPer100, tip: PITCHING_TIP, fmt: signed2 },
              ].filter((g) => typeof g.value === "number" && !isNaN(g.value)).map((g) => (
                <HeaderStat key={g.key} label={g.label} value={g.fmt(g.value)} title={g.tip} rank={headerRank(g.key, g.value)} />
              ))}
            </div>
          </div>
          {arsenalCard(false)}
          {/* Per-type percentiles beside VAA by zone: two mid-height cards in one row. */}
          <div className={`grid grid-cols-1 gap-4 ${vaaByZone && vaaByZone.length > 0 ? "lg:grid-cols-[1fr_360px]" : ""}`}>
            {/* Per-pitch percentiles, same row component, ranked against that pitch type */}
            {perTypeBp && rows.length > 0 && (
              <PitchTypePercentiles rows={rows} perTypeBp={perTypeBp} active={percentilePitchTab} onPick={setPercentilePitchTab} />
            )}

            {/* VAA by Zone Grid */}
            {vaaByZone && vaaByZone.length > 0 && (
              <div className="glass-panel p-4" data-glow="green">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-3">VAA by Zone</h2>
                {/* Pitch-type filter pills */}
                <div className="flex items-center gap-1 mb-3">
                  <button
                    onClick={() => setVaaPitchFilter("all")}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                      vaaPitchFilter === "all"
                        ? "bg-usf-green/20 border-usf-green/40 text-usf-gold"
                        : "border-border-subtle text-text-dim hover:bg-white/[0.05]"
                    }`}
                  >
                    All
                  </button>
                  {pitches.map((p: any) => {
                    const pt = (p.pitchType || "FF") as PitchType;
                    const cfg = PITCH_CONFIG[pt] || PITCH_CONFIG.FF;
                    const isActive = vaaPitchFilter === pt;
                    return (
                      <button
                        key={pt}
                        onClick={() => setVaaPitchFilter(pt)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                          isActive
                            ? "bg-usf-green/20 border-usf-green/40 text-usf-gold"
                            : "border-border-subtle text-text-dim hover:bg-white/[0.05]"
                        }`}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: cfg.color }} />
                        {cfg.shortLabel}
                      </button>
                    );
                  })}
                </div>
                <VAAGrid
                  data={
                    vaaPitchFilter === "all"
                      ? vaaByZone
                      : (vaaByPitch as any[]).filter((v: any) => v.pitchType === vaaPitchFilter)
                  }
                  tints={vaaPitchFilter === "all" ? undefined : vaaTints(vaaPct?.[vaaPitchFilter])}
                />
                {/* Each cell ranked among MLB pitchers' same pitch in the same zone (never across zones). */}
                <div className="mt-3">
                  {vaaPitchFilter === "all" ? (
                    <p className="text-[10px] text-text-dim">Pick a pitch to rank each zone against MLB pitchers&apos; same pitch in the same zone.</p>
                  ) : (
                    <PercentileGroup
                      title={<span className="text-[10px] font-normal text-text-dim">Percentile vs {vaaSeason ?? ""} MLB, same pitch, same zone</span>}
                      rows={vaaPct?.[vaaPitchFilter] ?? []}
                    />
                  )}
                  {vaaPitchFilter !== "all" && (vaaPct?.[vaaPitchFilter]?.length ?? 0) > 0 && (
                    <p className="-mt-2 text-[10px] text-text-dim">
                      VAA is descriptive here (grey): the flatter-is-better direction has not been re-measured on MLB.
                      Under 5 pitches in a zone: no bar, n only.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* The arm-slot file (PP13) and the 3D stuff lab (PP13's scene). */}
          <ArmSlotFile slot={slot} perTypeBp={perTypeBp} season={profile.season} />
          <DynamicStuffLab
            pitches={rows}
            confidence={profile.confidence}
            release={release}
            season={profile.season}
          />
        </div>
      ) : (
      <div className="space-y-5">
        {/* One percentile panel. Every rank on the page reads the same population. */}
        {percentiles?.pitchers && (
          <PercentilePanel
            peer={peerLine}
            toggle={null}
            banner={(thinBf !== null || thinGrade !== null) && (
              <ThinSampleBanner>
                Small sample: {sampleLine}. Rows need {PROFILE_PCT_FLOOR.bf} batters faced (model grades{" "}
                {PROFILE_PCT_FLOOR.pitches} pitches) to fill in a percentile; below that the rank still shows but
                hollow — dashed, with the sample under it — so nothing here reads as elite or poor on a handful of hitters.
              </ThinSampleBanner>
            )}
            footer={
              <AboutThis label="How to read these">
                Each row is his rank, 1 to 99, among all graded MLB pitchers this season; the tick is the median.
                Green is good for him, red bad, whatever the stat&apos;s direction (a low FIP ranks high). Grey
                circles are descriptive rates with no good direction, and n= in place of a rank means too few events
                to rank. Grades are descriptive, not forecasts.
              </AboutThis>
            }
          >
            <PercentileGroup title="Stuff" rows={[
              statRow("pitcher", "stuffPlus", "Whiff+", profile.stuffPlus, int0, pitcherBp?.stuffPlus, thinGrade),
              statRow("pitcher", "kPlus", "K+", profile.kPlus, int0, pitcherBp?.kPlus, thinGrade),
              statRow("pitcher", "whiffPct", "Whiff%", profile.whiffPct, pct1, pitcherBp?.whiffPct, thinBf),
              statRow("pitcher", "cswPct", "CSW%", profile.cswPct, pct1, pitcherBp?.cswPct, thinBf),
            ]} />
            <PercentileGroup title="Results" rows={[
              statRow("pitcher", "preventionPlus", "Prevention+", profile.preventionPlus, int0, pitcherBp?.preventionPlus, thinGrade),
              statRow("pitcher", "pitchingPlus", "Pitching+", profile.pitchingPlus, int0, pitcherBp?.pitchingPlus, thinGrade),
              statRow("pitcher", "controlPlus", "Control+", profile.controlPlus, int0, pitcherBp?.controlPlus, thinGrade),
              statRow("pitcher", "rvPer100", "RV/100", profile.rvPer100, signed2, pitcherBp?.rvPer100, thinBf),
              statRow("pitcher", "fip", "FIP", profile.fip, dec2, pitcherBp?.fip, thinBf),
              statRow("pitcher", "era", "RA/9", profile.era, dec2, pitcherBp?.era, thinBf),
              statRow("pitcher", "gbPct", "GB%", profile.gbPct, pct1, pitcherBp?.gbPct, thinBf),
            ]} />
            <PercentileGroup title="Contact against" rows={[
              statRow("pitcher", "xwobaAg", "xwOBA", profile.xwobaAg, dec3, pitcherBp?.xwobaAg, thinBf),
              statRow("pitcher", "xbaAg", "xBA", profile.xbaAg, dec3, pitcherBp?.xbaAg, thinBf),
              statRow("pitcher", "xslgAg", "xSLG", profile.xslgAg, dec3, pitcherBp?.xslgAg, thinBf),
              statRow("pitcher", "xwobaconAg", "xwOBACON", profile.xwobaconAg, dec3, pitcherBp?.xwobaconAg, thinBf),
              statRow("pitcher", "evAg", "Avg EV", profile.evAg, (v) => v.toFixed(1), pitcherBp?.evAg, thinBf),
              statRow("pitcher", "hardHitPctAg", "Hard-hit%", profile.hardHitPctAg, pct1, pitcherBp?.hardHitPctAg, thinBf),
              statRow("pitcher", "barrelPctAg", "Barrel%", profile.barrelPctAg, pct1, pitcherBp?.barrelPctAg, thinBf),
              statRow("pitcher", "sweetSpotPctAg", "Sweet-spot%", profile.sweetSpotPctAg, pct1, pitcherBp?.sweetSpotPctAg, thinBf),
            ]} />
            <PercentileGroup title="Swings against (bat tracking)" rows={[
              statRow("pitcher", "batSpeedAg", "Bat speed", profile.batSpeedAg, (v) => v.toFixed(1), pitcherBp?.batSpeedAg),
              statRow("pitcher", "squaredUpPctAg", "Squared-up%", profile.squaredUpPctAg, pct1, pitcherBp?.squaredUpPctAg),
              statRow("pitcher", "blastPctAg", "Blast%", profile.blastPctAg, pct1, pitcherBp?.blastPctAg),
            ]} />
            <PercentileGroup title="Run value by family" rows={[
              statRow("pitcher", "rvPer100Fb", "Fastballs", profile.rvPer100Fb, signed2, pitcherBp?.rvPer100Fb),
              statRow("pitcher", "rvPer100Br", "Breaking", profile.rvPer100Br, signed2, pitcherBp?.rvPer100Br),
              statRow("pitcher", "rvPer100Os", "Offspeed", profile.rvPer100Os, signed2, pitcherBp?.rvPer100Os),
            ]} />
            <PercentileGroup title={<>Expected run value <span className="font-normal text-text-dim">· descriptive</span></>} rows={[
              statRow("pitcher", "xrvPer100", "xRV/100", profile.xrvPer100, signed2, pitcherBp?.xrvPer100),
              statRow("pitcher", "rvLuck", "RV − xRV", profile.rvLuck, signed2, pitcherBp?.rvLuck),
            ]} />
            <PercentileGroup title="P7 value" rows={[
              statRow("pitcher", "kPlus", "K+", profile.kPlus, int0, pitcherBp?.kPlus, thinGrade),
              statRow("pitcher", "preventionPlus", "Prevention+", profile.preventionPlus, int0, pitcherBp?.preventionPlus, thinGrade),
              statRow("pitcher", "controlPlus", "Control+", profile.controlPlus, int0, pitcherBp?.controlPlus, thinGrade),
              statRow("pitcher", "kProj", "K proj", profile.kProj, (v) => v.toFixed(3).replace(/^0/, ""), pitcherBp?.kProj, thinGrade),
              statRow("pitcher", "pitchingRunsPer100", "Runs+/100", profile.pitchingRunsPer100, signed2, pitcherBp?.pitchingRunsPer100, thinGrade),
            ]} />
            <PercentileGroup title="Command" rows={[
              statRow("pitcher", "kPct", "K%", profile.kPct, pct1, pitcherBp?.kPct, thinBf),
              statRow("pitcher", "bbPct", "BB%", profile.bbPct, pct1, pitcherBp?.bbPct, thinBf),
              statRow("pitcher", "kBbPct", "K-BB%", profile.kBbPct, pct1, pitcherBp?.kBbPct, thinBf),
              statRow("pitcher", "velo", "Velo", profile.velo, (v) => v.toFixed(1), pitcherBp?.velo, thinBf),
            ]} />
          </PercentilePanel>
        )}

        {(profile.kProjLo != null || profile.rvProjLo != null) && (() => {
          const kBp = pitcherBp?.kProj ? Object.fromEntries(Object.entries(pitcherBp.kProj).map(([k, v]) => [k, 100 * (v as number)])) as any : null;
          return (
            <div className="glass-panel p-4">
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Next-season projection</h2>
              {profile.kProj != null && <ProjectionBand label="K%" value={100 * profile.kProj}
                lo={profile.kProjLo != null ? 100 * profile.kProjLo : null} hi={profile.kProjHi != null ? 100 * profile.kProjHi : null}
                bp={kBp} fmt={(v) => v.toFixed(1) + "%"}
                rank={pitcherBp?.kProj ? getPitcherPercentileRank("kProj", profile.kProj, pitcherBp.kProj) : null} />}
              <ProjectionBand label="Run value / 100 (runs saved)" value={profile.rvProj} lo={profile.rvProjLo} hi={profile.rvProjHi}
                bp={pitcherBp?.rvProj} fmt={signed2}
                rank={pitcherBp?.rvProj && profile.rvProj != null ? getPitcherPercentileRank("rvProj", profile.rvProj, pitcherBp.rvProj) : null} />
              <p className="mt-1 text-[10px] text-text-dim">
                Point: the K+ and Prevention+ projections (Prevention+ shown in its own units, next-season RV/100). Shaded: the range 80% of
                past pitchers projected from this many batters faced actually landed in, measured out of sample, not a model&apos;s error bar.
                Grey: the league&apos;s middle 80% of the same projection; tick = median.
              </p>
            </div>
          );
        })()}

        <a href={`/api/card/${playerId}?season=${profile.season}`} target="_blank" rel="noopener"
          className="inline-block text-[11px] text-text-dim underline-offset-2 hover:text-text-secondary hover:underline">
          Percentile card (PNG) ↗
        </a>

        <TrendPanel trend={profile.trend} role="pitcher" />
        <LeagueScatter role="pitcher" season={Number(profile.season)} id={String(playerId)} level={level} />

        {/* Raw plate discipline (P4): rates + descriptive season ranks. The EB
            shrinkage behind the college fork's sample-adjusted rankings does not
            carry to MLB, so no shrunk twins ship yet — the re-measured version
            lands when the reliability constants are re-measured here. */}
        {percentiles?.pitchers && (profile.swStrPct != null || profile.chasePct != null) && (
          <PercentilePanel
            peer={`Raw plate discipline · ${peerLine}`}
            toggle={null}
            footer={
              <AboutThis label="How to read these">
                The rate printed is raw; the rank is sample-adjusted — the bake shrinks each rate toward the season&apos;s
                league rate with its measured half-signal (MLB split-half, 2023–25) before ranking, so a two-event
                0.0 no longer outranks a real rate. Hollow ranks below the sample floor, as everywhere.
              </AboutThis>
            }
          >
            <PercentileGroup title="Swing & miss" rows={[
              discRow("zWhiffPct", "Z-Whf%", profile),
              discRow("oWhiffPct", "O-Whf%", profile),
              discRow("chasePct", "Chase%", profile),
              discRow("zContactPct", "Z-Con%", profile),
              discRow("oContactPct", "O-Con%", profile),
              discRow("swStrPct", "SwStr%", profile),
              discRow("putawayPct", "PutAwy%", profile),
            ]} />
            <PercentileGroup title="Approach" rows={[
              discRow("zonePct", "Zone%", profile),
              discRow("zSwingPct", "Z-Swg%", profile),
              discRow("swingPct", "Swing%", profile),
              discRow("calledStrikePct", "CS%", profile),
              discRow("firstPitchStrikePct", "F-Str%", profile),
            ]} />
          </PercentilePanel>
        )}

        {/* How he gets outs: pitch table beside the movement plot (VAA by zone is on the Arsenal tab) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {arsenalCard(true)}

          {/* Right column: Movement Profile */}
          <div className="space-y-4">
            <div className="glass-panel p-4" data-glow="slider">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Movement Profile</h2>
              <MovementPlot data={movementProfile} cloud={profile.movementCloud} slot={slot} throws={profile.throws} height={330} />
            </div>
          </div>
        </div>

        {/* Results by pitch side: release traits + batted-ball profile. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Release Traits */}
          {release.relHeight && (
            <div className="glass-panel p-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Release Traits</h2>
              <div className="flex flex-wrap gap-6 text-xs">
                <div><span className="text-text-dim">Height:</span> <span className="font-data text-text-primary">{Number(release.relHeight).toFixed(2)} ft</span> <span className="text-text-dim text-[10px]">(±{Number(release.relHeightSD).toFixed(2)})</span></div>
                <div><span className="text-text-dim">Side:</span> <span className="font-data text-text-primary">{Number(release.relSide).toFixed(2)} ft</span> <span className="text-text-dim text-[10px]">(±{Number(release.relSideSD).toFixed(2)})</span></div>
                <div><span className="text-text-dim">Extension:</span> <span className="font-data text-text-primary">{Number(release.extension).toFixed(2)} ft</span></div>
              </div>
              <p className="mt-2 text-[10px] text-text-dim">Season means; the ± is the SD across his pitches. Per-pitch release plots land in a later wave.</p>
            </div>
          )}

          {/* Batted Ball Profile */}
          {orderedBattedBall.length > 0 && (
            <div className="glass-panel overflow-hidden" data-glow="gold">
              <div className="px-4 py-2.5 border-b border-border-subtle">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Batted Ball Against</span>
              </div>
              <div className="overflow-x-auto"><div className="min-w-max">
                <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
                  <div className="w-[50px]">Pitch</div>
                  <div className="w-[48px] text-right">N_BIP</div>
                  <div className="w-[48px] text-right">GB%</div>
                  <div className="w-[48px] text-right">FB%</div>
                  <div className="w-[48px] text-right">LD%</div>
                  <div className="w-[48px] text-right">PU%</div>
                  <div className="w-[52px] text-right">Avg EV</div>
                  <div className="w-[52px] text-right">Avg LA</div>
                  <div className="w-[56px] text-right">HrdHit%</div>
                </div>
                {orderedBattedBall.map((bb: any, i: number) => {
                  const pt = (bb.pitchType || "FF") as PitchType;
                  const config = PITCH_CONFIG[pt] || PITCH_CONFIG.FF;
                  const nBip = bb.n_bip || bb.nBip || 0;
                  const thin = nBip < THIN_BIP;
                  return (
                    <div
                      key={pt}
                      title={thin ? `${nBip} ball${nBip === 1 ? "" : "s"} in play — shown because a rare type put in play is a finding, marked because ${nBip} of them is not a rate` : undefined}
                      className={`flex items-center px-4 border-b border-white/[0.025] ${i % 2 === 1 ? "bg-white/[0.012]" : ""} ${thin ? "opacity-70" : ""}`}
                      style={{ height: "38px" }}
                    >
                      <div className="w-[50px] flex items-center gap-1.5">
                        <div className="w-[3px] h-[16px] rounded-full" style={{ backgroundColor: config.color }} />
                        <span className="text-xs font-medium text-text-primary">{config.shortLabel}</span>
                      </div>
                      <div className="w-[48px] text-right text-xs font-data text-text-secondary">{nBip}</div>
                      <div className="w-[48px] text-right text-xs font-data text-text-secondary">{bb.gbPct?.toFixed(1) ?? "—"}</div>
                      <div className="w-[48px] text-right text-xs font-data text-text-secondary">{bb.fbPct?.toFixed(1) ?? "—"}</div>
                      <div className="w-[48px] text-right text-xs font-data text-text-secondary">{bb.ldPct?.toFixed(1) ?? "—"}</div>
                      <div className="w-[48px] text-right text-xs font-data text-text-secondary">{bb.puPct?.toFixed(1) ?? "—"}</div>
                      <div className="w-[52px] text-right text-xs font-data text-text-secondary">{bb.avgEv?.toFixed(1) ?? "—"}</div>
                      <div className="w-[52px] text-right text-xs font-data text-text-secondary">{bb.avgLa?.toFixed(1) ?? "—"}</div>
                      <div className="w-[56px] text-right text-xs font-data text-text-secondary">{bb.hardHitPct?.toFixed(1) ?? "—"}</div>
                    </div>
                  );
                })}
              </div></div>
              <p className="px-4 py-2 text-[10px] text-text-dim leading-[1.5]">
                Every pitch type he threw, ordered by balls in play. Rows under{" "}
                {THIN_BIP} BIP are dimmed rather than dropped — a slider put in play twice is a fact about the slider.
              </p>
            </div>
          )}
        </div>

        {/* Value panels: the mix description (PP11), the measured run-value card
            (PP9) and the location mix (PP20). All measured, all descriptive. */}
        <ArsenalOverview mix={profile.mix} season={profile.season} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PitchRvCard data={pitchRv} season={profile.season} />
          {zoneMix && <LocationMixPanel data={zoneMix} playerId={playerId} name={profile.name} />}
          <SituationalRunsPanel data={situational ?? null} name={profile.name} />
        </div>
      </div>
      )}
      </ProfileTabPanel>
    </div>
  );
}
