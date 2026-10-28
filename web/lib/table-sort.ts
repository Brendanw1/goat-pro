/**
 * One comparator for every sortable leaderboard.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * There were four sortable boards and three different comparators. Hitters,
 * pitchers and tunneling each carried a correct copy; the arsenal board carried
 * `(value ?? 0)`, and the three API routes carried `(value ?? 0)` as well. A
 * blank became a real zero and was then ranked as though the pitcher had scored
 * it, which is wrong in three separate ways at once. Measured on the 4,818-row
 * FF board:
 *
 *   - Pitch+ runs 70..130, so a fake 0 beats every real pitcher. Sorting
 *     ASCENDING put 1,475 blank rows above the first real value -- a full page
 *     of dashes. Descending hid it completely, which is why it looked
 *     intermittent.
 *   - contactSuppressionZ runs -0.51..1.04, so 0 is INSIDE the range. Its 2,574
 *     blanks landed at ranks 1436-4009, wedged between +0.001 and -0.001.
 *     Neither direction can fix that one: the column reads real values, then
 *     2,574 dashes, then real values again.
 *   - `"Smith" - "Jones"` is NaN, and the spec coerces a NaN comparator result
 *     to +0 -- "equal" -- so sorting by Name or Team silently did nothing at all
 *     while still highlighting the header.
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 * 1. A missing value is not a value. null, undefined, NaN and +/-Infinity sort
 *    to the BOTTOM in both directions. A blank is "we do not know", and "we do
 *    not know" is never the best or the worst row on the board.
 * 2. Two blanks compare EQUAL, not 1. The old comparator returned 1 from
 *    whichever argument it tested first, so cmp(a,b) and cmp(b,a) both said
 *    "a after b" -- an antisymmetry violation that lets a spec-compliant
 *    TimSort return anything. It never misordered on today's data (5,400 trials
 *    over 50 null-bearing columns found zero), but it was true by luck, and
 *    returning 0 makes the sort stable instead: blanks hold their input order.
 * 3. Strings compare with localeCompare, never subtraction.
 * 4. A mixed pair falls back to string comparison rather than NaN. No column in
 *    the export is mixed today; this is here so a future one degrades to a
 *    defined order instead of silently not sorting.
 */

export type SortDir = "asc" | "desc";

/** A value the board can rank. Anything else is a blank. */
function rankable(v: unknown): v is number | string {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string";
}

/**
 * Compare two already-extracted cell values.
 *
 * Split out from `compareBy` because the arsenal board does not read its sort
 * value straight off the row -- discipline columns go through
 * `rankableValue()`, which picks the shrunk twin and returns null when the cell
 * is not rankable at all. That gating has to stay upstream of this.
 */
export function compareValues(av: unknown, bv: unknown, dir: SortDir): number {
  const aOk = rankable(av);
  const bOk = rankable(bv);
  // Blanks last, both directions, and equal to each other so the sort is stable.
  if (!aOk || !bOk) return aOk ? -1 : bOk ? 1 : 0;

  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = dir === "desc" ? bv - av : av - bv;
  } else {
    const c = String(av).localeCompare(String(bv));
    cmp = dir === "desc" ? -c : c;
  }
  // `-c` on an equal pair is NEGATIVE zero, and Object.is(-0, 0) is false. Sort
  // does not care, but a comparator that reports a tie as -0 makes any
  // antisymmetry assertion over it fail on a pair that is genuinely equal.
  return cmp === 0 ? 0 : cmp;
}

/**
 * Compare two rows on one key.
 *
 * `T` is unconstrained and the read is cast, deliberately. Constraining it to
 * `Record<string, unknown>` rejects every row interface in this app -- HitterRow,
 * PitcherRow, TunnelRow, ArsenalExpandedRow -- because a declared interface has
 * no index signature. The alternative is adding `[k: string]: unknown` to each
 * of them, which would switch off typo checking on every property access those
 * types exist to protect.
 */
export function compareBy<T>(a: T, b: T, key: string, dir: SortDir): number {
  const rec = (r: T) => r as unknown as Record<string, unknown>;
  return compareValues(rec(a)[key], rec(b)[key], dir);
}

/** The comparator to hand to `Array.prototype.sort`. */
export function sortComparator<T>(key: string, dir: SortDir) {
  return (a: T, b: T) => compareBy(a, b, key, dir);
}
