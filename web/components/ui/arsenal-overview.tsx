"use client";

import { ordinal } from "@/lib/percentiles";
/**
 * Arsenal overview (PP11): the five mix metrics — how many offerings, how
 * evenly used, how far apart, how repeatable, how wide. A description of the
 * arsenal, not a grade: the college study found none of these predicted next
 * season beyond Pitching+ and the pitcher's own prior year, so the percentile
 * bars are neutral grey and nothing is verdict-coloured.
 */

interface MixMetric {
  key: string;
  label: string;
  title: string;
  fmt: (v: number) => string;
  unit?: string;
}

const METRICS: MixMetric[] = [
  { key: "nTypes", label: "Pitches", title: "Pitch types he throws at least 3% of the time", fmt: (v) => String(Math.round(v)) },
  { key: "effTypes", label: "Effective mix", title: "How evenly he uses them: three pitches at a third each count as 3.0; 80/15/5 counts as about 1.8", fmt: (v) => v.toFixed(1) },
  { key: "separation", label: "Separation", title: "Average distance between his pitch types in velocity (mph) and movement (in): how different the offerings are", fmt: (v) => v.toFixed(1) },
  { key: "repeatSd", label: "Shape scatter", title: "How much each pitch's movement varies around its own average, usage-weighted. Lower = more repeatable. The one piece tied to strikeouts.", fmt: (v) => v.toFixed(1), unit: " in" },
  { key: "veloSpread", label: "Velo range", title: "Fastest minus slowest pitch type, by average velocity", fmt: (v) => v.toFixed(1), unit: " mph" },
];

export function ArsenalOverview({ mix, season }: { mix: any | null; season?: number }) {
  if (!mix || typeof mix !== "object") return null;
  return (
    <div className="glass-panel p-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-3">Arsenal</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-3">
        {METRICS.map((m) => {
          const v = mix[m.key];
          const pct = mix.pct?.[m.key];
          return (
            <div key={m.key} title={m.title}>
              <div className="text-[10px] uppercase tracking-wider text-text-dim">{m.label}</div>
              <div className="font-data text-base text-text-primary mt-0.5">
                {typeof v === "number" ? m.fmt(v) : "—"}
                {typeof v === "number" && m.unit ? <span className="text-[10px] text-text-dim">{m.unit}</span> : null}
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                {typeof pct === "number" && (
                  <div className="h-full bg-text-secondary/60" style={{ width: `${Math.max(3, pct)}%` }} />
                )}
              </div>
              <div className="text-[10px] text-text-dim mt-0.5">{typeof pct === "number" ? `${ordinal(pct)} pct` : ""}</div>
            </div>
          );
        })}
      </div>
      {Array.isArray(mix.types) && mix.types.length > 0 && (
        <p className="mt-2.5 text-[10px] text-text-dim">{mix.types.join(" · ")}</p>
      )}
      {interpretMix(mix) && (
        <p className="mt-2.5 text-xs leading-relaxed text-text-secondary" aria-label="What this arsenal looks like">
          {interpretMix(mix)}
        </p>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim">
        {season ?? ""} season, {(mix.n ?? 0).toLocaleString()} pitches; percentiles vs MLB pitchers with 100+ that
        season. A description of the arsenal, not a grade: none of these predicted next season beyond Pitching+ and
        his own prior year. For shape scatter a higher percentile is MORE scatter.
      </p>
    </div>
  );
}

/**
 * The five metrics in coach language — what the numbers say about how he
 * attacks hitters. Banded at the 30/70 percentiles the bake ships; a metric
 * with nothing to say is dropped rather than padded into the sentence.
 */
function interpretMix(mix: any): string | null {
  const out: string[] = [];
  const nTypes = mix.nTypes;
  const effPct = mix.pct?.effTypes;
  if (typeof nTypes === "number") {
    const even =
      effPct == null ? "" : effPct >= 70 ? ", used unusually evenly" : effPct <= 30 ? ", with one clear go-to" : "";
    out.push(`${nTypes} offerings${even}`);
  }
  const sepPct = mix.pct?.separation;
  if (sepPct != null) {
    out.push(sepPct >= 70 ? "big gaps between them" : sepPct <= 30 ? "offerings that blend together" : "about-average gaps between them");
  }
  const repPct = mix.pct?.repeatSd;
  if (repPct != null) {
    // the scatter percentile runs HIGHER = MORE scatter, so a low pct repeats
    out.push(repPct <= 30 ? "each pitch repeats its shape" : repPct >= 70 ? "shapes that wobble start to start — the one piece here tied to strikeouts" : "about-average repeatability");
  }
  const vsPct = mix.pct?.veloSpread;
  if (vsPct != null) {
    out.push(vsPct >= 70 ? "a wide velo range" : vsPct <= 30 ? "a narrow velo range" : "a typical velo range");
  }
  if (!out.length) return null;
  return `The shape of it: ${out[0]}${out.length > 1 ? " — " : ""}${out.slice(1).join(", ")}.`;
}
