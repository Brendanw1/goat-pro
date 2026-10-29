import Link from "next/link";
import { getArchetypesAll } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Swing archetypes" };

/**
 * Swing archetypes (RESULTS-MLB §94, pipeline/swing_archetypes.py). Six bat-tracking traits per hitter-season
 * (competitive swings), z-scored on 2024–25, k-means at the BIC-chosen k. Stable, but no outcome information
 * beyond bat speed: descriptive, not a forecast.
 */
const COL = ["#e3b341", "#7da1c4", "#9bbf85", "#c48ab0"];
const DIM = "#5d6577";
const BANDS = ["≤26", "27–30", "31+"];
const sgn = (v: number, dp = 2) => {
  const r = Number(v.toFixed(dp)); // round first: (-0.0004).toFixed(3) is "-0.000" — the minus must not survive the rounding
  return `${r > 0 ? "+" : ""}${r.toFixed(dp)}`;
};
const r3 = (v: number) => Number(v.toFixed(3)).toFixed(3).replace(/^0/, "");

function Fig({ title, n, read, children }: { title: string; n: string; read?: string; children: React.ReactNode }) {
  return (
    <figure className="glass-panel p-4 flex flex-col">
      <figcaption className="mb-2">
        <h2 className="text-[13px] font-semibold text-text-primary leading-snug">{title}</h2>
        <div className="text-[10px] text-text-dim">{n}</div>
      </figcaption>
      <div className="flex-1">{children}</div>
      {read ? <p className="mt-2 text-[11px] text-text-secondary leading-snug">{read}</p> : null}
    </figure>
  );
}

/** PCA map of the z-space: x flipped so right = longer / faster / more pull; up = steeper attack angle and tilt. */
function MapChart({ pts }: { pts: any[] }) {
  const W = 640, H = 380, P = 26;
  const xs = pts.map((p) => -p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (v: number) => P + ((v - x0) / (x1 - x0)) * (W - 2 * P), sy = (v: number) => P / 2 + (1 - (v - y0) / (y1 - y0)) * (H - 1.5 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label="map of hitter-season swings, coloured by archetype">
      <line x1={sx(0)} x2={sx(0)} y1={P / 2} y2={H - P} stroke="rgba(255,255,255,0.08)" />
      <line x1={P} x2={W - P} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.08)" />
      {pts.map((p, i) => (
        <circle key={i} cx={sx(-p[0])} cy={sy(p[1])} r={2.2} fill={COL[p[2]]} opacity={0.55}>
          <title>{`${p[5] ?? p[4]} ${p[3]}`}</title>
        </circle>
      ))}
      <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={9} fill={DIM}>shorter, slower, opposite-field ← component 1 → longer, faster, pull-side</text>
      <text x={10} y={H / 2} fontSize={9} fill={DIM} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">flatter ← component 2 → steeper, more vertical</text>
    </svg>
  );
}

function AgingBars({ a, lg, key2 }: { a: any[]; lg: any; key2: "bs" | "sl" }) {
  const unit = key2 === "bs" ? "mph" : "ft", dp = key2 === "bs" ? 2 : 3;
  const vals = a.flatMap((x) => BANDS.map((b) => x.aging[b]?.[key2]).filter(Boolean).flatMap((c: any) => c.ci));
  const m = Math.max(...vals.map(Math.abs), 0.05);
  const W = 300, rowH = 15, PL = 46;
  const sx = (v: number) => PL + ((v + m) / (2 * m)) * (W - PL - 78);
  const H = BANDS.length * (a.length * rowH + 8) + 16;
  let y = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label={`year-to-year change in ${key2} by archetype and age`}>
      <line x1={sx(0)} x2={sx(0)} y1={0} y2={H - 14} stroke="rgba(255,255,255,0.15)" />
      {BANDS.map((b) => {
        const g = (
          <g key={b}>
            <text x={2} y={y + 10} fontSize={9} fill={DIM}>{b}</text>
            {a.map((x, j) => {
              const c = x.aging[b]?.[key2], yy = y + j * rowH + 7;
              if (!c) return <text key={j} x={sx(0) + 4} y={yy + 3} fontSize={8} fill={DIM}>n &lt; 20</text>;
              return (
                <g key={j}>
                  <line x1={sx(c.ci[0])} x2={sx(c.ci[1])} y1={yy} y2={yy} stroke={COL[j]} strokeWidth={1.4} />
                  <circle cx={sx(c.mean)} cy={yy} r={3} fill={COL[j]} />
                  <text x={W - 4} y={yy + 3} textAnchor="end" fontSize={8} fill={DIM}>{sgn(c.mean, dp)} (n {c.n})</text>
                </g>
              );
            })}
            {lg[b] && <line x1={sx(lg[b][key2])} x2={sx(lg[b][key2])} y1={y + 2} y2={y + a.length * rowH + 4} stroke="#fff" strokeDasharray="2 2" opacity={0.5} />}
          </g>
        );
        y += a.length * rowH + 8;
        return g;
      })}
      <text x={(PL + W - 78) / 2} y={H - 2} textAnchor="middle" fontSize={8} fill={DIM}>change next season ({unit}) · dashed = all hitters</text>
    </svg>
  );
}

export default async function ArchetypesPage() {
  const d = await getArchetypesAll();
  if (!d) return <div className="glass-panel p-8 text-center text-sm text-text-dim">Archetypes have not been baked yet (pipeline/swing_archetypes.py).</div>;
  const { meta, archetypes: a, points } = d;
  const st = meta.stability, b = meta.claimBRes, rep = meta.claimBRep;
  const ci = (x: any) => `${sgn(x.d_wr2, 3)} (CI ${sgn(x.ci[0], 3)} to ${sgn(x.ci[1], 3)})`;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Swing archetypes</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Six Statcast bat-tracking traits per hitter-season: bat speed, swing length, attack angle, attack direction (pull +), swing path
        tilt and contact depth. Means over competitive swings, MLB {meta.seasons[0]}–{meta.seasons[meta.seasons.length - 1]} regular season,
        hitters with {meta.floors.swings}+ competitive swings and {meta.floors.contact}+ contacts. The traits are scaled to SDs and grouped
        with k-means at the number of groups a Gaussian mixture&apos;s BIC picked ({meta.k}). Contact depth is measured from the batter, so it
        carries where he stands in the box. Descriptive, not a forecast (RESULTS-MLB §94).
      </p>

      <Fig title={`Swings sit on a continuum with two broad ends, not tight types: ${a.map((x: any) => x.label).join(" vs ")}`}
        n={`${points.length.toLocaleString()} hitter-seasons · PCA of the six scaled traits (components explain ${Math.round(100 * meta.pca.var[0])}% and ${Math.round(100 * meta.pca.var[1])}%) · one dot per hitter-season`}
        read="The cloud has no gaps: the two types are the two halves of one long axis (bat speed, length, pull and depth rise together). Hover a dot for the hitter.">
        <MapChart pts={points} />
        <div className="mt-2 flex flex-wrap gap-4 text-[11px]">
          {a.map((x: any) => <span key={x.id} style={{ color: COL[x.id] }}>● {x.label} ({x.n} hitter-seasons, {x.hitters} hitters)</span>)}
        </div>
      </Fig>

      <div className="grid gap-4 lg:grid-cols-2">
        <Fig title={`The types are stable: ${Math.round(100 * st.yoy.same)}% of hitters keep theirs from 2024 to 2025 (chance ${Math.round(100 * st.yoy.chance)}%)`}
          n={`k-means, k = ${meta.k} · ${st.yoy.n} hitters with both seasons · bootstrap = 200 hitter resamples`}
          read="Gate (a) passed for k-means only. The Gaussian mixture and Ward clusterings of the same data split differently on every resample, which is what a continuum with no natural breaks looks like.">
          <table className="w-full text-xs font-data">
            <thead><tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="py-1 text-left font-semibold">Method</th><th className="py-1 text-right font-semibold">Bootstrap ARI</th>
              <th className="py-1 text-right font-semibold">2024→25 ARI</th><th className="py-1 text-right font-semibold">Same type</th>
            </tr></thead>
            <tbody>
              {Object.entries(meta.methods).map(([k, v]: [string, any]) => (
                <tr key={k} className={`border-t border-white/[0.04] ${k === meta.method ? "text-text-primary" : "text-text-dim"}`}>
                  <td className="py-1 font-sans">{k === "gmm" ? "Gaussian mixture" : k === "ward" ? "Ward hierarchical" : "k-means"}</td>
                  <td className="py-1 text-right">{v.boot_median_ari.toFixed(2)}</td>
                  <td className="py-1 text-right">{v.yoy.ari.toFixed(2)}</td>
                  <td className="py-1 text-right">{Math.round(100 * v.yoy.same)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-text-dim">Bars (pre-registered): bootstrap ARI ≥ .60, year-to-year ARI ≥ .40, same type ≥ 60%.</div>
        </Fig>

        <Fig title="The type says nothing about next season's contact quality that bat speed does not; the six traits themselves do"
          n={`${b.n} hitter pairs (2024→25, 2025→26) · next-season xwOBA on contact · out-of-fold weighted R², hitter-grouped folds and bootstrap`}>
          <table className="w-full text-xs font-data">
            <tbody>
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">Type, beyond bat speed (the claim)</td><td className="py-1 text-right">{ci(b)}</td></tr>
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">Type, beyond bat speed + last xwOBAcon</td><td className="py-1 text-right">{ci(rep.beyond_bs_and_last_xwobacon)}</td></tr>
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">The five other traits, beyond bat speed</td><td className="py-1 text-right">{ci(rep.six_traits_beyond_bs)}</td></tr>
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">Type, beyond all six traits</td><td className="py-1 text-right">{ci(rep.archetype_beyond_six_traits)}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-text-secondary leading-snug">
            Change in weighted R² (bat speed alone: {b.base_wr2.toFixed(2)}). Cutting the traits into types throws their information away:
            use the traits (Swing tab) for anything predictive and the type as a one-word description.
          </p>
        </Fig>
      </div>

      <Fig title="Profiles: one type is faster, longer, steeper and further out front on every trait but tilt" n="mean per hitter-season · z = SDs from the 2024–25 hitter mean">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-data">
            <thead><tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="py-1 text-left font-semibold">Trait</th>
              {a.map((x: any) => <th key={x.id} className="py-1 text-right font-semibold" style={{ color: COL[x.id] }}>{x.label}</th>)}
            </tr></thead>
            <tbody>
              {meta.traits.map((t: string) => (
                <tr key={t} className="border-t border-white/[0.04]">
                  <td className="py-1 font-sans text-text-secondary">{meta.traitLabel[t]}</td>
                  {a.map((x: any) => <td key={x.id} className="py-1 text-right">{x.mean[t].toFixed(1)} <span className="text-text-dim">({sgn(x.z[t], 1)})</span></td>)}
                </tr>
              ))}
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">xwOBA on contact, same season</td>
                {a.map((x: any) => <td key={x.id} className="py-1 text-right">{r3(x.xwobacon)}</td>)}</tr>
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">xwOBA on contact, next season</td>
                {a.map((x: any) => <td key={x.id} className="py-1 text-right">{x.nextXwobacon == null ? "—" : r3(x.nextXwobacon)} <span className="text-text-dim">(n {x.nPairs})</span></td>)}</tr>
              <tr className="border-t border-white/[0.04]"><td className="py-1 font-sans text-text-secondary">Examples</td>
                {a.map((x: any) => (
                  <td key={x.id} className="py-1 text-right font-sans">
                    {x.examples.map((e: any, i: number) => (
                      <span key={i}>{i ? ", " : ""}<Link href={`/player/${e.batter}?season=${e.season}&tab=swing`} className="hover:underline">{e.name}</Link> {e.season}</span>
                    ))}
                  </td>
                ))}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-text-secondary leading-snug">
          The faster type does more damage on contact, which is bat speed; with bat speed held the type adds nothing (above).
        </p>
      </Fig>

      <Fig title="Both types gain bat speed while young; the short, flat type keeps gaining into his late 20s"
        n="delta method: the same hitter one season to the next, both seasons over the floor · age = Statcast age that season · 95% hitter-bootstrap CI · cells under 20 pairs hidden"
        read="Survival bias: only hitters who played the next season count, and the deltas include any league-wide shift between seasons (dashed line). With two season pairs these are wide bands, not curves.">
        <div className="grid gap-4 md:grid-cols-2">
          <div><div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Bat speed</div><AgingBars a={a} lg={meta.leagueAging} key2="bs" /></div>
          <div><div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Swing length</div><AgingBars a={a} lg={meta.leagueAging} key2="sl" /></div>
        </div>
      </Fig>

      <div className="glass-panel p-4 text-[11px] text-text-secondary leading-relaxed max-w-[95ch]">
        <p><strong className="text-text-primary">Comps.</strong> Each hitter&apos;s Swing tab lists the five closest hitter-seasons by distance
          across the six scaled traits (other hitters only, 2024–26). Same caveat: a similar swing shape, not a similar hitter.</p>
        <p className="mt-2 text-text-dim">Not shown: a bat-speed drift injury flag (§95). Game-to-game bat speed drops did not precede IL
          stints more than chance, so there is no bat speed watch.</p>
      </div>
    </div>
  );
}
