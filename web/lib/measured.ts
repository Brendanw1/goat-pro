/** Measured constants (shrinkage half-signals, stabilization points, league baselines), written by their measure
 *  scripts through scripts/measured.py, which also writes this TS copy. A missing key throws: never a silent default. */
import FILE from "./measured-2026.json";

const M = FILE as Record<string, unknown>;
export function measured<T = number>(key: string): T {
  if (!(key in M)) throw new Error(`${key} is not in lib/measured-2026.json: run its measure script (scripts/measured.py)`);
  return M[key] as T;
}
