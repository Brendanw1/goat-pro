/**
 * VAA by zone percentiles (scripts/bake_vaa_zone_pct.py -> vaa_zone_pct.json): a pitch type's average VAA in one
 * zone cell, ranked among same-season MLB pitchers' cells of the same type in the same cell. Never across zones: VAA
 * is mostly where the pitch crosses the plate.
 *
 * Direction comes from the bake (per pitch pool x height row, from whiff / xwOBAcon evidence): +1 flatter is the good
 * side, -1 steeper is, 0 = descriptive (grey, ranked by flatness). A directional rank is "goodness", like every other
 * profile percentile, so on a steeper-is-good row a 90 means steeper than 90% of peers.
 */
import type { PctRow } from "@/components/ui/percentile-row";
import { fromQ, getPercentileRank, pctPool } from "./percentiles";
/** Below the floor but n >= FADE_MIN_N: still ranked off his raw cell VAA, drawn as small-sample. */
const FADE_MIN_N = 5;

export interface VaaZoneFile {
  season?: string;
  floor: number;
  direction: Record<string, Record<string, -1 | 0 | 1>>;
  cells: Record<string, Record<string, { q: number[]; n: number }>>;
}

export interface VaaCell { pitchType: string; zone_x: string; zone_z: string; avg_vaa: number; n: number }

const ORDER = ["high", "mid", "low"].flatMap((z) => ["arm", "mid", "glove"].map((x) => `${z}-${x}`));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** {pitchType: rows in grid order} for one pitcher's vaaByPitch cells. */
export function vaaZoneRows(file: VaaZoneFile | null | undefined, cells: VaaCell[]): Record<string, PctRow[]> {
  const out: Record<string, PctRow[]> = {};
  for (const c of cells) {
    const pool = pctPool(c.pitchType);
    const key = `${c.zone_z}-${c.zone_x}`;
    const peers = file?.cells[pool]?.[key];
    const dir = file?.direction[pool]?.[c.zone_z] ?? 0;
    const floor = file?.floor ?? 15;
    // Below the floor but n >= FADE_MIN_N: still ranked off his raw cell VAA, drawn as small-sample (owner 2026-10-23).
    const flat = file && peers && c.n >= FADE_MIN_N ? getPercentileRank(c.avg_vaa, fromQ(peers.q)) : null;
    const small = flat !== null && c.n < floor;
    const rank = flat === null ? null : dir === -1 ? 100 - flat : flat;
    const where = `${file?.season ?? ""} MLB ${pool} ${c.zone_z} ${c.zone_x} cells (${peers?.n ?? 0} pitchers, ${file?.floor ?? 15}+ pitches)`;
    const title =
      flat === null
        ? peers ? `${c.n} pitches here; ${FADE_MIN_N}+ needed to draw, ${floor}+ to rank firmly` : "No MLB peer group for this cell"
        : small
          ? `Small sample: ${c.n} of ${floor} pitches. Placed from his raw VAA here; read it as a lean, not a rank.`
        : dir === 0
          ? `Flatter than ${flat}% of ${where}. Descriptive: no clear whiff or xwOBA link with VAA here.`
          : `${dir === 1 ? "Flatter" : "Steeper"} than ${rank}% of ${where}; ${dir === 1 ? "flatter" : "steeper"} is the better side here (more whiffs or less damage).`;
    (out[c.pitchType] ??= []).push({
      key,
      label: `${cap(c.zone_z)} ${c.zone_x}`,
      display: `${c.avg_vaa.toFixed(1)}°`,
      rank,
      neutral: dir === 0,
      n: c.n < floor ? c.n : null,
      floor: small ? floor : undefined,
      nUnit: "pitches",
      title,
      note: dir === 1 ? "flatter better" : dir === -1 ? "steeper better" : "no verdict",
    });
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return out;
}
