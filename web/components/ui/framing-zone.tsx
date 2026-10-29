"use client";

/**
 * The Framing+ zone visual: where a catcher steals strikes, as a 5x5 heat grid
 * over the plate (rows = height in zone half-heights, middle three rows span
 * the zone; columns = plate half-widths, middle three inside the white lines).
 * Cell colour is the mean called-strike residual — strikes taken above the
 * model's expectation — green for stolen, red for lost; the count gates what
 * renders (40+ taken pitches per cell). Click a board row to open it.
 */

import { useState } from "react";

export function FramingZoneGrid({ zone }: { zone: Record<string, { r: number; n: number }> | null }) {
  if (!zone) return null;
  const cell = (zi: number, xi: number) => zone[`${zi}-${xi}`];
  const max = Math.max(0.08, ...Object.values(zone).map((c) => Math.abs(c.r)));
  const ZL = ["above", "upper", "middle", "lower", "below"];
  const XL = ["off in", "inner edge", "heart", "outer edge", "off out"];
  return (
    <div className="inline-block">
      <div className="grid grid-cols-5 gap-[2px] p-1 rounded-md bg-black/30">
        {ZL.map((zl, zi) =>
          XL.map((xl, xi) => {
            const c = cell(zi, xi);
            const v = c ? c.r / max : 0;
            const bg = !c
              ? "rgba(255,255,255,0.04)"
              : v >= 0
                ? `rgba(91,168,143,${0.15 + 0.75 * v})`
                : `rgba(224,101,79,${0.15 + 0.75 * -v})`;
            return (
              <div key={`${zi}-${xi}`} className="w-14 h-10 rounded-sm flex flex-col items-center justify-center"
                style={{ background: bg }} title={`${zl} · ${xl}${c ? ` — ${(c.r * 100).toFixed(1)} strikes / 100 pitches, ${c.n} taken` : " — under 40 taken"}`}>
                <span className="text-[10px] font-data text-white/90 leading-none">
                  {c ? `${(c.r >= 0 ? "+" : "")}${(c.r * 100).toFixed(0)}` : "·"}
                </span>
                <span className="text-[8px] font-data text-white/50 leading-none mt-0.5">{c ? c.n : ""}</span>
              </div>
            );
          }),
        )}
      </div>
      <div className="text-[9px] text-text-dim mt-1 leading-relaxed max-w-[380px]">
        strikes per 100 taken pitches above the model&apos;s expectation (green = stolen, red = lost);
        small number is taken pitches in the cell; middle 3x3 is the strike zone.
      </div>
    </div>
  );
}

export function FramingZoneRow({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr key={row.id} className="border-t border-white/[0.04] cursor-pointer hover:bg-white/[0.02]" onClick={() => setOpen(!open)}>
        <td className="px-4 py-1.5 font-sans text-text-primary">{row.name ?? row.id} <span className="text-text-dim text-[9px]">{open ? "▾" : "▸"}</span></td>
        <td className="px-2 py-1.5 text-right text-text-dim">{row.taken.toLocaleString()}</td>
        <td className="px-2 py-1.5 text-right text-text-primary">{row.plus.toFixed(1)}</td>
        <td className="px-2 py-1.5 text-right text-text-secondary">{row.runs > 0 ? "+" : ""}{row.runs.toFixed(2)}</td>
        <td className="px-2 py-1.5 text-right text-text-secondary">{row.strikes.toFixed(0)}</td>
        <td className="px-2 py-1.5 text-right text-text-dim">{row.savantRv != null ? (row.savantRv > 0 ? "+" : "") + row.savantRv.toFixed(2) : "—"}</td>
      </tr>
      {open && (
        <tr className="border-t border-white/[0.04]">
          <td colSpan={6} className="px-4 py-3 bg-black/20">
            <div className="flex items-start gap-4 flex-wrap">
              <FramingZoneGrid zone={row.zone} />
              <div className="text-[10px] text-text-dim max-w-[280px] leading-relaxed self-center">
                <span className="text-text-secondary">{row.name ?? row.id}, {row.season}.</span> Framing+ {row.plus.toFixed(1)}
                {" "}({row.runs > 0 ? "+" : ""}{row.runs.toFixed(1)} runs, {row.strikes.toFixed(0)} strikes above expectation over{" "}
                {row.taken.toLocaleString()} taken pitches). The model holds location, count, handedness and pitch
                fixed and never saw his own pitches (catcher-grouped folds); Savant&apos;s board reads {row.savantRv != null ? `${row.savantRv > 0 ? "+" : ""}${row.savantRv.toFixed(1)}` : "—"} beside it.
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
