import Link from "next/link";
import { notFound } from "next/navigation";
import { isId, isSeason } from "@/lib/r2";
import { getPlayerProfile, getHitterProfile, getPercentiles, getHitterPercentiles, getHitterScouting } from "@/lib/data";
import { logoUrl } from "@/lib/team-pixel";
import { getPitcherPercentileRank, getStatPercentileRank, ordinal } from "@/lib/percentiles";
import { GradeScopeToggle } from "@/components/ui/grade-pct";
import { GradePctProvider } from "@/components/ui/grade-pct";
import { PrintButton } from "@/components/ui/print-button";
import { BackLink } from "@/components/ui/back-link";
import { fmtIp } from "@/lib/ip";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Player sheet" };

/**
 * The player sheet (D-21): the one-page printable summary — a report card of
 * the season's headline numbers, the arsenal or slash block, and the sample
 * line, in a layout that survives a printer. Everything on it is measured or
 * carries its label; there is nothing here but what the profile already says,
 * arranged for a coach's clipboard.
 */

const pct1 = (v: number) => v.toFixed(1);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="font-data text-base font-bold text-text-primary">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-text-dim">{label}</div>
      {sub && <div className="text-[9px] font-data text-text-secondary">{sub}</div>}
    </div>
  );
}

/** .241 style (three decimals, no leading zero), "—" when missing. */
const rate3 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(3).replace(/^0(?=\.)/, "") : "—");
/** 53 -> "53rd", 11 -> "11th". */

export default async function PlayerSheetPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ season?: string; level?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  if (!isId(id) || (sp.season != null && sp.season !== "" && !isSeason(sp.season))) notFound();
  const level = sp.level === "aaa" ? "aaa" : "mlb";
  const profile = (await getPlayerProfile(id, sp.season, level)) ?? (await getHitterProfile(id, sp.season, level));
  if (!profile) {
    return <div className="glass-panel p-8 text-center text-sm text-text-dim">No profile for {id}.</div>;
  }
  const season = String(profile.season ?? "");
  const percentiles = await getPercentiles(season, level);
  const scouting = profile.position === "H" ? await getHitterScouting(id, season, level) : null;
  const crest = logoUrl(profile.team);
  const isHitter = profile.position === "H" || !!scouting;
  // the hitter or pitcher pool of his season, ranked the way the profile ranks (direction-aware)
  const seasonP = isHitter
    ? (await getHitterPercentiles(season, level))?.by_season?.[season] ?? null
    : percentiles?.by_season?.[season]?.pitchers ?? null;

  const rankPct = (metric: string, v: unknown): string => {
    const bp = seasonP?.[metric];
    if (typeof v !== "number" || !bp) return "";
    return ordinal(Math.round(isHitter ? getStatPercentileRank(metric, v, bp) : getPitcherPercentileRank(metric, v, bp)));
  };

  return (
    <GradePctProvider data={null}>
      <div className="max-w-[860px] mx-auto space-y-4 sheet-page">
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          <BackLink fallback={`/player/${id}?season=${season}`} label="← Full profile" className="text-[11px] text-text-dim hover:text-text-secondary" />
          <div className="flex items-center gap-2">
            <GradeScopeToggle />
            <PrintButton />
          </div>
        </div>

        {/* report card header */}
        <div className="glass-panel px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={crest} alt="" width={40} height={40} className="rounded" />
              ) : null}
              <div>
                <h1 className="text-xl font-bold text-text-primary leading-tight">{profile.name ?? id}</h1>
                <p className="text-xs text-text-dim">
                  {profile.team ?? "—"}
                  {profile.position === "H" ? (profile.bats ? ` · bats ${profile.bats}` : "")
                    : profile.p_throws ? ` · ${profile.p_throws}HP` : ""}
                  {profile.age ? ` · age ${profile.age}` : ""} · {season}
                  {level === "aaa" ? " · AAA (Statcast)" : ""}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center rounded border border-usf-gold/50 bg-usf-gold/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-usf-gold">
                Descriptive — not a forecast
              </span>
              <p className="text-[9px] text-text-dim mt-1">goatpro.dev · measured from tracked pitches</p>
            </div>
          </div>

          {/* headline strip */}
          <div className="flex flex-wrap gap-x-8 gap-y-3 justify-between mt-4 pt-3 border-t border-border-subtle">
            {isHitter ? (
              <>
                <Stat label="PA" value={String(profile.pa ?? "—")} />
                <Stat label="AVG" value={rate3(profile.avg)} sub={rankPct("avg", profile.avg)} />
                <Stat label="OBP" value={rate3(profile.obp)} sub={rankPct("obp", profile.obp)} />
                <Stat label="SLG" value={rate3(profile.slg)} sub={rankPct("slg", profile.slg)} />
                <Stat label="wOBA" value={rate3(profile.woba)} sub={rankPct("woba", profile.woba)} />
                <Stat label="K%" value={profile.kPct != null ? `${profile.kPct}%` : "—"} sub={rankPct("kPct", profile.kPct)} />
                <Stat label="EV90" value={profile.ev90 != null ? `${profile.ev90}` : "—"} sub={rankPct("ev90", profile.ev90)} />
                <Stat label="Brl%" value={profile.barrelPct != null ? `${profile.barrelPct}%` : "—"} sub={rankPct("barrelPct", profile.barrelPct)} />
              </>
            ) : (
              <>
                <Stat label="IP" value={profile.ip != null ? fmtIp(profile.ip) : "—"} />
                <Stat label="K%" value={profile.kPct != null ? `${profile.kPct}%` : "—"} sub={rankPct("kPct", profile.kPct)} />
                <Stat label="BB%" value={profile.bbPct != null ? `${profile.bbPct}%` : "—"} sub={rankPct("bbPct", profile.bbPct)} />
                <Stat label="CSW%" value={profile.cswPct != null ? `${profile.cswPct}%` : "—"} sub={rankPct("cswPct", profile.cswPct)} />
                <Stat label="RV/100" value={profile.rvPer100 != null ? (profile.rvPer100 > 0 ? `+${profile.rvPer100}` : String(profile.rvPer100)) : "—"} sub={rankPct("rvPer100", profile.rvPer100)} />
                <Stat label="Whiff+" value={profile.stuffPlus != null ? String(Math.round(profile.stuffPlus)) : "—"} sub={rankPct("stuffPlus", profile.stuffPlus)} />
                <Stat label="K+" value={profile.kPlus != null ? String(Math.round(profile.kPlus)) : "—"} sub="proj. next season" />
                <Stat label="Prevention+" value={profile.preventionPlus != null ? String(Math.round(profile.preventionPlus)) : "—"} />
              </>
            )}
          </div>
          {isHitter && scouting?.skill?.type && (
            <p className="mt-3 pt-2 border-t border-border-subtle text-xs text-text-secondary">
              Skill card: {scouting.skill.power ?? "—"} power · {scouting.skill.contact ?? "—"} contact ·{" "}
              {scouting.skill.eye ?? "—"} eye — {scouting.skill.type}.
            </p>
          )}
        </div>

        {/* arsenal (pitchers) or batted-ball (hitters) */}
        {!isHitter && Array.isArray(profile.pitches) && profile.pitches.length > 0 && (
          <div className="glass-panel overflow-hidden">
            <div className="px-4 py-2 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">Arsenal</div>
            <div className="overflow-x-auto"><SortableTable className="w-full min-w-max text-xs font-data">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
                  <SortTh className="px-3 py-1.5 text-left font-semibold">Type</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">N</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">Usage</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">Velo</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">IVB</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">HB</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">Whiff%</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">CSW%</SortTh>
                  <SortTh className="px-2 py-1.5 text-right font-semibold">RV/100</SortTh>
                </tr>
              </thead>
              <tbody>
                {profile.pitches.map((p: any) => (
                  <tr key={p.pitchType} className="border-b border-white/[0.03]">
                    <td className="px-3 py-1 font-sans text-text-primary">{p.pitchType}</td>
                    <td className="px-2 py-1 text-right">{(p.n_pitches ?? p.nPitches ?? 0).toLocaleString("en-US")}</td>
                    <td className="px-2 py-1 text-right">{p.usage != null ? `${p.usage}%` : "—"}</td>
                    <td className="px-2 py-1 text-right">{p.velo ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{p.ivb ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{p.hb ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{p.whiffPct != null ? `${p.whiffPct}%` : "—"}</td>
                    <td className="px-2 py-1 text-right">{p.cswPct != null ? `${p.cswPct}%` : "—"}</td>
                    <td className="px-2 py-1 text-right">{p.rv100 != null ? (p.rv100 > 0 ? `+${p.rv100}` : String(p.rv100)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </SortableTable></div>
          </div>
        )}

        {isHitter && (
          <div className="glass-panel px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              ["GB%", profile.gbPct], ["LD%", profile.ldPct], ["FB%", profile.fbPct], ["PU%", profile.puPct],
              ["Hard-hit%", profile.hardHitPct], ["Whiff%", profile.whiffPct], ["O-Swing%", profile.oSwingPct], ["Zone-seen%", profile.zonePctSeen],
            ].map(([label, v]) => (
              <div key={label as string} className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] pb-1">
                <span className="text-text-dim">{label as string}</span>
                <span className="font-data text-text-primary">{v != null ? `${v}%` : "—"}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[9px] text-text-dim leading-[1.6]">
          Sample: {isHitter
            ? `${profile.pa ?? "—"} PA · ${profile.pitchesSeen?.toLocaleString?.() ?? "—"} pitches seen · ${profile.nBip ?? "—"} balls in play`
            : `${profile.ip?.toFixed?.(1) ?? "—"} IP · ${profile.battersFaced?.toLocaleString?.() ?? "—"} BF · ${profile.nPitches?.toLocaleString?.() ?? "—"} pitches`}.
          All numbers are measured from tracked pitches or carry the descriptive label — see goatpro.dev/glossary for
          definitions, scales and gate status. Grades read 100 = average, 10 points = one standard deviation; 20-80
          skill estimates are percentile bands, not forecasts.
        </p>
      </div>
    </GradePctProvider>
  );
}
