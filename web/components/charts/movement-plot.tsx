"use client";

/**
 * The movement plot — HB × IVB in inches, drawn on purpose:
 *
 *   - one marker per pitch type at its season mean, sized by usage;
 *   - the hollow diamond is what pitchers from HIS arm slot throw for that
 *     type (slot-conditional league mean, the slot file's expIvb/expHb), with
 *     a dashed connector — the gap is his shape vs his slot's shape. A
 *     description, not a grade: no verdict colour on the delta.
 *   - x is mirrored for lefties, so "arm side" is always to the right;
 *   - axes, quadrants and labels are drawn here, not inherited from a chart
 *     library's defaults.
 *
 * PP7, with the A3 slot-expected shapes carried over.
 */
import { PITCH_CONFIG } from "@/lib/constants";
import type { MovementPoint, PitchType } from "@/types";

export interface SlotTypeRow {
  type: string; n: number; arm: number | null;
  ivb: number | null; hb: number | null;
  expIvb: number | null; expHb: number | null;
  dIvb: number | null; dHb: number | null;
  dIvbPct: number | null; dHbPct: number | null;
  /** spread of the slot band's season shapes around the expectation (in) */
  sdIvb?: number | null; sdHb?: number | null;
}

/** One subsampled pitch of the shaded backdrop. */
export interface CloudPoint { t: string; x: number; y: number }

const W = 360, H = 330;
const PAD_L = 40, PAD_R = 16, PAD_T = 16, PAD_B = 34;

function signed(v: number, d = 1): string {
  return (v > 0 ? "+" : "") + v.toFixed(d);
}

export function MovementPlot({ data, cloud, slot, throws, height = 340 }: {
  data: MovementPoint[];
  /** Subsampled per-pitch backdrop, drawn shaded darkly under everything. */
  cloud?: CloudPoint[];
  /** His arm-slot file — the slot-expected shapes ride on it. */
  slot?: { types?: SlotTypeRow[] } | null;
  throws?: string | null;
  height?: number;
}) {
  if (!data.length) {
    return (
      <div className="relative w-full aspect-square bg-white/[0.02] rounded-lg border border-border-subtle flex items-center justify-center">
        <span className="text-[11px] text-text-dim">No movement data</span>
      </div>
    );
  }
  const mirror = throws === "L" || throws === "Left";
  const mx = (hb: number) => (mirror ? -hb : hb);

  const slotByType = new Map((slot?.types ?? []).map((r) => [r.type, r]));
  const points = data.map((p) => {
    const s = slotByType.get(p.pitchType);
    return {
      code: p.pitchType as PitchType,
      hb: mx(p.hb), ivb: p.ivb,
      usage: s?.n ?? 0,
      expHb: s?.expHb != null ? mx(s.expHb) : null,
      expIvb: s?.expIvb ?? null,
      dIvb: s?.dIvb ?? null, dHb: s?.dHb != null ? mx(s.dHb) : null,
      dIvbPct: s?.dIvbPct ?? null, dHbPct: s?.dHbPct ?? null,
      sdIvb: s?.sdIvb ?? null, sdHb: s?.sdHb ?? null,
    };
  });

  const lim = Math.max(20, Math.ceil(Math.max(
    ...points.flatMap((p) => [Math.abs(p.ivb), Math.abs(p.hb),
      p.expIvb != null ? Math.abs(p.expIvb) : 0, p.expHb != null ? Math.abs(p.expHb) : 0]),
  ) / 5) * 5) + 5;

  const x = (hb: number) => PAD_L + ((hb + lim) / (2 * lim)) * (W - PAD_L - PAD_R);
  const y = (ivb: number) => PAD_T + ((lim - ivb) / (2 * lim)) * (H - PAD_T - PAD_B);
  const xPerIn = (W - PAD_L - PAD_R) / (2 * lim);
  const yPerIn = (H - PAD_T - PAD_B) / (2 * lim);

  const gridLines: number[] = [];
  for (let v = -lim; v <= lim; v += 5) gridLines.push(v);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} role="img"
        aria-label="Movement profile: horizontal break vs induced vertical break, one marker per pitch type, with his arm slot's expected shape">
        {gridLines.map((v) => (
          <g key={`g${v}`}>
            <line x1={x(v)} y1={PAD_T} x2={x(v)} y2={H - PAD_B} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={x(v)} y={H - PAD_B + 12} textAnchor="middle" fontSize={8} fill="#8B93A3">{v}</text>
            {v !== 0 && <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize={8} fill="#8B93A3">{v}</text>}
          </g>
        ))}
        <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
        <line x1={x(0)} y1={PAD_T} x2={x(0)} y2={H - PAD_B} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
        <text x={W - PAD_R - 4} y={y(0) - 6} textAnchor="end" fontSize={9} fill="#8B93A3">arm side →</text>
        <text x={PAD_L + 4} y={y(0) - 6} fontSize={9} fill="#8B93A3">← glove side</text>
        <text x={x(0) + 6} y={PAD_T + 10} fontSize={9} fill="#8B93A3">ride</text>
        <text x={x(0) + 6} y={H - PAD_B - 6} fontSize={9} fill="#8B93A3">run / sink</text>

        {/* the season's pitches, shaded darkly: the shape he actually repeats */}
        {(cloud ?? []).map((c, i) => {
          const cfg = PITCH_CONFIG[c.t as PitchType] ?? PITCH_CONFIG.FF;
          return <circle key={i} cx={x(mx(c.x))} cy={y(c.y)} r={1.4} fill={cfg.color} fillOpacity={0.16} />;
        })}

        {points.map((p) => {
          const cfg = PITCH_CONFIG[p.code] ?? PITCH_CONFIG.FF;
          const hasExp = p.expIvb != null && p.expHb != null;
          const sdX = (p.sdHb ?? 0) * xPerIn, sdY = (p.sdIvb ?? 0) * yPerIn;
          const r = 4.5 + Math.min(5, Math.sqrt(Math.max(p.usage ?? 0, 0)) * 0.9);
          const tip = [
            `${cfg.label} — IVB ${p.ivb?.toFixed(1)}″, HB ${p.hb?.toFixed(1)}″`,
            hasExp && `slot expects ${p.expIvb?.toFixed(1)}/${p.expHb?.toFixed(1)} (${signed(p.dIvb!)}″ ride, ${signed(p.dHb!)}″ arm-side)`,
            hasExp && p.dIvbPct != null && `delta rank: ride ${p.dIvbPct}th, arm-side ${p.dHbPct}th in his slot band`,
          ].filter(Boolean).join(" · ");
          return (
            <g key={p.code}>
              <title>{tip}</title>
              {hasExp && (
                <>
                  <line x1={x(p.hb)} y1={y(p.ivb)} x2={x(p.expHb!)} y2={y(p.expIvb!)}
                    stroke={cfg.color} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
                  {/* the slot expectation as a circle with its uncertainty:
                      1 SD (solid ring) and 2 SD (faint) of the band's shapes */}
                  <ellipse cx={x(p.expHb!)} cy={y(p.expIvb!)} rx={Math.max(3, sdX * 2)} ry={Math.max(3, sdY * 2)}
                    fill="none" stroke={cfg.color} strokeWidth={0.8} opacity={0.25} />
                  <ellipse cx={x(p.expHb!)} cy={y(p.expIvb!)} rx={Math.max(3, sdX)} ry={Math.max(3, sdY)}
                    fill="none" stroke={cfg.color} strokeWidth={1.2} opacity={0.6} />
                  <circle cx={x(p.expHb!)} cy={y(p.expIvb!)} r={1.6} fill={cfg.color} fillOpacity={0.8} />
                </>
              )}
              <circle cx={x(p.hb)} cy={y(p.ivb)} r={r} fill={cfg.color} fillOpacity={0.9}
                stroke="#0a0e0d" strokeWidth={1.5} />
              <text x={x(p.hb) + r + 4} y={y(p.ivb) + 3} fontSize={9.5} fontWeight={600}
                fill="#f0f2f4">{cfg.shortLabel}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {points.map((p) => {
          const cfg = PITCH_CONFIG[p.code] ?? PITCH_CONFIG.FF;
          return (
            <span key={p.code} className="inline-flex items-center gap-1 text-[10px] text-text-dim">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
              {cfg.shortLabel}
              {p.expIvb != null && (
                <span className="font-data" title="his shape minus what his slot's pitchers throw">
                  {signed(p.dIvb!)}/{signed(p.dHb!)}
                </span>
              )}
            </span>
          );
        })}
        <span className="text-[10px] text-text-dim ml-auto">
          ring = slot expectation ±1σ/2σ · HB mirrored for LHP · descriptive
        </span>
      </div>
    </div>
  );
}
