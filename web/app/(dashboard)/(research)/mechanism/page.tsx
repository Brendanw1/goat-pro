import { getMechanismTables } from "@/lib/data";
import { DescriptiveChip } from "@/lib/grades";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mechanism — why whiffs happen" };

/**
 * The physics study as site content (depth item 9): the "why" layer that
 * travels under every Whiff+ grade — what Hawk-Eye measurement says actually
 * causes misses, measured within pitch type on 2.12M pitches (2023-25).
 * Re-publishes the study's tables verbatim with provenance; the compute
 * lives in pipeline/MECHANISM-MLB.md / physics.py, not here.
 */
export default async function MechanismPage() {
  const m = await getMechanismTables();
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Mechanism — why whiffs happen</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
      </div>
      <p className="text-xs text-text-dim max-w-[85ch] leading-relaxed">
        Every Whiff+ grade on this site prices <em>what</em> a pitch is — velocity, movement, spin, release, how it
        differs from the pitcher&apos;s fastball. This page is the <span className="text-text-secondary">why</span>:
        the physics study&apos;s own measurements of what Hawk-Eye can isolate and college radar could not —
        trajectory-derived active spin, drag, and the velocity × shape interaction — on 2.12M regular-season pitches
        (2023-25). Every number is a marginal effect <em>within</em> pitch type; the tables are the study&apos;s,
        re-published verbatim ({m?._provenance?.split(";")[0] ?? "pipeline/MECHANISM-MLB.md"}).
      </p>

      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1">1 — Active spin helps fastballs, hurts breaking balls</h2>
        <p className="text-[11px] text-text-dim mb-2 max-w-[80ch]">
          Whiff rate by active-spin quartile (Q1 lowest → Q4 highest). The sign flips by class: on fastballs more
          active spin means more carry and more misses; on sliders, gyro spin — the stuff &ldquo;wasted&rdquo; spin
          orthodoxy wrote off — delays the break, and gyro sliders whiff MORE. Verified within stratum: holding
          Magnus-implied movement fixed, low-active-spin sliders out-whiff high-active-spin ones in every tercile.
        </p>
        <SortableTable className="w-full text-xs font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <SortTh className="py-1 text-left font-semibold">Type</SortTh>
              <SortTh className="py-1 text-right font-semibold">Q1 whiff%</SortTh>
              <SortTh className="py-1 text-right font-semibold">Q4 whiff%</SortTh>
              <SortTh className="py-1 text-left font-semibold pl-4">Effect</SortTh>
            </tr>
          </thead>
          <tbody>
            {(m?.activeSpinQuartiles?.rows ?? []).map((r: any) => (
              <tr key={r.type} className="border-t border-white/[0.04]">
                <td className="py-1 font-sans text-text-secondary">{r.type}</td>
                <td className="py-1 text-right text-text-dim">{r.q1}%</td>
                <td className="py-1 text-right text-text-primary">{r.q4}%</td>
                <td className="py-1 pl-4 text-text-secondary">{r.effect}</td>
              </tr>
            ))}
          </tbody>
        </SortableTable>
      </div>

      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1">2 — Shape matters more as velocity rises</h2>
        <p className="text-[11px] text-text-dim mb-2 max-w-[80ch]">
          Fastball/sinker whiff% by velocity tercile × IVB tercile. The IVB spread widens from 2.2 points at low
          velocity to 6.1 at high: velocity is the enabler, shape the multiplier. Neither &ldquo;shape matters most
          mid-velo&rdquo; nor &ldquo;higher velo is always better&rdquo; alone describes it — the correct structure is
          the interaction, which is why the grading models learn it.
        </p>
        <table className="w-full text-xs font-data">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-text-dim">
              <th className="py-1 text-left font-semibold">Velocity</th>
              <th className="py-1 text-right font-semibold">IVB low</th>
              <th className="py-1 text-right font-semibold">IVB mid</th>
              <th className="py-1 text-right font-semibold">IVB high</th>
              <th className="py-1 text-right font-semibold pl-4">Shape spread</th>
            </tr>
          </thead>
          <tbody>
            {(m?.veloShapeGrid?.rows ?? []).map((r: any) => (
              <tr key={r.velo} className="border-t border-white/[0.04]">
                <td className="py-1 font-sans text-text-secondary">{r.velo}</td>
                <td className="py-1 text-right text-text-dim">{r.ivbLow}%</td>
                <td className="py-1 text-right text-text-secondary">{r.ivbMid}%</td>
                <td className="py-1 text-right text-text-primary">{r.ivbHi}%</td>
                <td className="py-1 text-right pl-4 text-text-primary">{r.spread} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1">3 — Drag is a small, real whiff signal</h2>
        <table className="w-full text-xs font-data">
          <tbody>
            {(m?.drag?.rows ?? []).map((r: any) => (
              <tr key={r.type} className="border-t border-white/[0.04]">
                <td className="py-1 font-sans text-text-secondary w-16">{r.type}</td>
                <td className="py-1 text-text-secondary">higher deceleration → {r.spread} whiff within type</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-text-dim mt-2">
          A Hawk-Eye-only measurement (the trajectory fit resolves deceleration radar smeared), consistent with
          seam-orientation effects — the candidate feature the study flagged low-priority.
        </p>
      </div>

      <p className="text-[10px] text-text-dim max-w-[85ch]">
        Method and reproduce: pipeline/MECHANISM-MLB.md — physics.add_physics over the pitch features, per-type
        quartile/tercile tables regenerate in under three minutes. The college verdict revisited: spin efficiency was
        &ldquo;below noise&rdquo; under TrackMan radar spin; under optical measurement the effect is real, 1-2.3
        points, and class-dependent. These tables describe; the grades remain the model&apos;s.
      </p>
    </div>
  );
}
