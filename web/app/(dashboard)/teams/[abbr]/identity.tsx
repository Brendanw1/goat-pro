import { getOrgIdentity } from "@/lib/data";
import { type Agg, teamMeans } from "./agg";

/**
 * Identity tab, Stage A (docs/team-pages-plan.md §3): the org's style as z-scores against the 30 clubs. Style, not
 * quality: dots are neutral and nothing is ranked better or worse. MLB traits from the season's boards (weighted club
 * means, as on Overview); farm and draft traits from orgs/identity.json (level-relative farm rates, five-class draft
 * window). Descriptive. Stage B (does an org have a stable, guessable tell?) is a pre-registered read not yet run.
 */

type T = { key: string; label: string; w: string; nd: number; unit?: string };
const H: T[] = [
  { key: "kPct", label: "K%", w: "pa", nd: 1 }, { key: "bbPct", label: "BB%", w: "pa", nd: 1 },
  { key: "iso", label: "ISO", w: "pa", nd: 3 }, { key: "swingPct", label: "Swing%", w: "pa", nd: 1 },
  { key: "oSwingPct", label: "Chase%", w: "pa", nd: 1 }, { key: "contactPct", label: "Contact%", w: "pa", nd: 1 },
  { key: "pullPct", label: "Pull%", w: "nBip", nd: 1 }, { key: "oppoPct", label: "Oppo%", w: "nBip", nd: 1 },
  { key: "ev90", label: "EV90", w: "nBip", nd: 1 }, { key: "batSpeed", label: "Bat speed", w: "pa", nd: 1 },
  { key: "attackAngle", label: "Attack angle", w: "pa", nd: 1 }, { key: "sprintSpeed", label: "Sprint speed", w: "pa", nd: 1 },
  { key: "age", label: "Age", w: "pa", nd: 1 },
];
const P: T[] = [
  { key: "velo", label: "Velo", w: "pitches", nd: 1 }, { key: "ivb", label: "IVB", w: "pitches", nd: 1 },
  { key: "stuffPlus", label: "Whiff+", w: "pitches", nd: 0 }, { key: "zonePct", label: "Zone%", w: "pitches", nd: 1 },
  { key: "chasePct", label: "Chase induced", w: "pitches", nd: 1 }, { key: "firstPitchStrikePct", label: "1st-pitch K%", w: "battersFaced", nd: 1 },
  { key: "gbPct", label: "GB%", w: "battersFaced", nd: 1 }, { key: "kPct", label: "K%", w: "battersFaced", nd: 1 },
  { key: "bbPct", label: "BB%", w: "battersFaced", nd: 1 }, { key: "age", label: "Age", w: "battersFaced", nd: 1 },
];
const FARM: [string, string, number][] = [
  ["fh_age", "Hitter age vs level", 2], ["fh_kPct", "Hitter K% vs level", 1], ["fh_bbPct", "Hitter BB% vs level", 1],
  ["fh_iso", "Hitter ISO vs level", 3], ["fp_age", "Pitcher age vs level", 2], ["fp_kPct", "Pitcher K% vs level", 1],
  ["fp_bbPct", "Pitcher BB% vs level", 1], ["fp_gbPct", "Pitcher GB% vs level", 1],
];
const DRAFT: [string, string, number][] = [["d_hs", "HS share of picks", 3], ["d_overslot", "Bonus over slot", 3]];

type Row = { label: string; group: string; v: number; z: number; vals: number[]; nd: number; fmt?: (v: number) => string };

function rows(group: string, all: Map<string, Record<string, number>>, abbr: string, spec: [string, string, number][]): Row[] {
  return spec.flatMap(([k, label, nd]) => {
    const vals = [...all.values()].map((m) => m[k]).filter((v) => typeof v === "number" && Number.isFinite(v));
    const v = all.get(abbr)?.[k];
    if (v == null || vals.length < 10) return [];
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1)) || 1;
    return [{ label, group, v, z: (v - mu) / sd, vals, nd }];
  });
}

const signed = (v: number, nd: number) => `${v > 0 ? "+" : ""}${v.toFixed(nd)}`;

function Strip({ r }: { r: Row }) {
  const lo = Math.min(...r.vals), hi = Math.max(...r.vals);
  const x = (v: number) => 6 + ((v - lo) / (hi - lo || 1)) * 148;
  const rel = r.group === "Farm" || r.label === "Bonus over slot";
  const shown = r.label === "HS share of picks" ? `${Math.round(100 * r.v)}%` : r.label === "Bonus over slot" ? signed(100 * r.v, 1) + "%" : rel ? signed(r.v, r.nd) : r.v.toFixed(r.nd);
  return (
    <div className="grid grid-cols-[150px_60px_160px_48px] items-center gap-2 py-1">
      <span className="text-[11px] text-text-secondary truncate">{r.label}</span>
      <span className="text-right font-data text-xs text-text-primary">{shown}</span>
      <svg viewBox="0 0 160 14" className="w-[160px] h-[14px]" aria-hidden>
        <line x1={6} x2={154} y1={7} y2={7} stroke="rgba(255,255,255,0.08)" />
        {r.vals.map((v, i) => <circle key={i} cx={x(v)} cy={7} r={2.4} fill="rgba(255,255,255,0.28)" />)}
        <circle cx={x(r.v)} cy={7} r={4.6} fill="var(--color-usf-gold)" stroke="var(--color-usf-green)" strokeWidth={1.5} />
      </svg>
      <span className={`text-right font-data text-[11px] ${Math.abs(r.z) >= 1.5 ? "text-text-primary font-semibold" : "text-text-dim"}`}>{signed(r.z, 1)}σ</span>
    </div>
  );
}

export default async function IdentityTab({ abbr, season, allP, allH }: { abbr: string; season: number; allP: any[]; allH: any[] }) {
  const id = await getOrgIdentity();
  const asAgg = (t: T[]): Agg[] => t.map((x) => ({ ...x, good: 1 }));
  const spec = (t: T[]) => t.map((x) => [x.key, x.label, x.nd] as [string, string, number]);
  const blocks: [string, Row[]][] = [
    ["MLB hitters", rows("MLB hitters", teamMeans(allH, asAgg(H)), abbr, spec(H))],
    ["MLB pitchers", rows("MLB pitchers", teamMeans(allP, asAgg(P)), abbr, spec(P))],
  ];
  const farm = id?.[String(season)] ? new Map<string, Record<string, number>>(Object.entries(id[String(season)])) : null;
  if (farm) {
    blocks.push(["Farm", rows("Farm", farm, abbr, FARM)]);
    blocks.push([`Draft, ${season - 4}–${season} classes`, rows("Draft", farm, abbr, DRAFT)]);
  }
  const top = blocks.flatMap(([, r]) => r).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 6);

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim max-w-[95ch]">
        How {abbr} plays and builds in {season}, as style rather than quality: each trait is the club&apos;s weighted mean set
        against all 30 clubs, as a z-score (σ). Dots are every club; none is better or worse. Farm traits are measured
        against each player&apos;s level, so a young or low-level farm doesn&apos;t read that way by construction.
        Descriptive. {farm ? null : <>Farm and draft traits start in 2021.</>}
      </p>
      {top.length > 0 && (
        <div className="glass-panel p-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Most distinctive</h2>
          <div className="flex flex-wrap gap-2">
            {top.map((r) => (
              <span key={r.group + r.label} className="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary">
                <span className="text-text-dim">{r.group.split(",")[0]} · </span>{r.label} <span className="font-data text-text-primary">{signed(r.z, 1)}σ</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {blocks.filter(([, r]) => r.length).map(([title, r]) => (
          <div key={title} className="glass-panel px-4 py-3">
            <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{title}</h2>
            {r.map((x) => <Strip key={x.label} r={x} />)}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-text-dim max-w-[95ch]">
        Identity test pending: whether clubs have a stable tell (a model that guesses the club from a player&apos;s profile,
        against chance, season to season) is a pre-registered research read that has not run yet. Until it does, these are
        descriptions of one season, not claims about an organization&apos;s philosophy.
      </p>
    </div>
  );
}
