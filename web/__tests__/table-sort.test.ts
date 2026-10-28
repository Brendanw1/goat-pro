import { describe, expect, it } from "vitest";
import { compareBy, compareValues, sortComparator, type SortDir } from "@/lib/table-sort";

/**
 * The comparator every sortable board uses.
 *
 * Each block below names the shipped failure it pins. All four were reproduced
 * on the real 4,818-row FF arsenal before the fix, and every one of these tests
 * fails against the `?? 0` comparator it replaced -- checked, not assumed.
 */

/** The comparator that shipped on the arsenal board, for the fails-before proof. */
const shipped = (dir: SortDir, key: string) => (a: any, b: any) => {
  const av = a[key] ?? 0;
  const bv = b[key] ?? 0;
  return dir === "desc" ? bv - av : av - bv;
};

const order = (rows: any[], cmp: (a: any, b: any) => number) =>
  [...rows].sort(cmp).map((r) => r.id);

describe("blank cells sort to the bottom in BOTH directions", () => {
  // Pitch+ runs 70..130. Under `?? 0` a blank became a real zero, so ASCENDING
  // put every blank above the lowest real pitcher -- a full page of dashes.
  const plusScale = [
    { id: "a", v: 130 },
    { id: "blank1", v: null },
    { id: "b", v: 70 },
    { id: "blank2", v: undefined },
    { id: "c", v: 100 },
  ];

  it("ascending ranks the real minimum first, not a blank", () => {
    expect(order(plusScale, sortComparator("v", "asc"))).toEqual([
      "b", "c", "a", "blank1", "blank2",
    ]);
  });

  it("descending ranks the real maximum first", () => {
    expect(order(plusScale, sortComparator("v", "desc"))).toEqual([
      "a", "c", "b", "blank1", "blank2",
    ]);
  });

  it("fails under the comparator this replaced", () => {
    // The old one hoisted both blanks above every real value when ascending.
    expect(order(plusScale, shipped("asc", "v")).slice(0, 2)).toEqual(["blank1", "blank2"]);
  });
});

describe("a blank never lands inside the range of real values", () => {
  // contactSuppressionZ runs -0.51..1.04, so zero is INSIDE it. Under `?? 0` its
  // 2,574 blanks sat at ranks 1436-4009, between +0.001 and -0.001, and no sort
  // direction could move them out.
  const zScores = [
    { id: "hi", v: 1.04 },
    { id: "blank", v: null },
    { id: "justAbove", v: 0.001 },
    { id: "justBelow", v: -0.001 },
    { id: "lo", v: -0.51 },
  ];

  it.each(["desc", "asc"] as const)("%s puts the blank last", (dir) => {
    expect(order(zScores, sortComparator("v", dir)).at(-1)).toBe("blank");
  });

  it("fails under the comparator this replaced", () => {
    // Wedged between the two values straddling zero, in both directions.
    expect(order(zScores, shipped("desc", "v"))).toEqual([
      "hi", "justAbove", "blank", "justBelow", "lo",
    ]);
  });
});

describe("string columns actually sort", () => {
  // `"Smith" - "Jones"` is NaN, and the spec coerces a NaN comparator result to
  // +0 -- "equal" -- so Name and Team returned the rows untouched while the
  // header still highlighted as sorted.
  const names = [
    { id: "1", name: "Smith" },
    { id: "2", name: "Alvarez" },
    { id: "3", name: "Jones" },
  ];

  it("ascending is A to Z", () => {
    expect(order(names, sortComparator("name", "asc"))).toEqual(["2", "3", "1"]);
  });

  it("descending is Z to A", () => {
    expect(order(names, sortComparator("name", "desc"))).toEqual(["1", "3", "2"]);
  });

  it("fails under the comparator this replaced", () => {
    // Input order, unchanged, in both directions.
    expect(order(names, shipped("asc", "name"))).toEqual(["1", "2", "3"]);
    expect(order(names, shipped("desc", "name"))).toEqual(["1", "2", "3"]);
  });
});

describe("the comparator is a valid total order", () => {
  // The boards' previous comparator returned 1 from whichever argument it tested
  // first, so cmp(a,b) and cmp(b,a) BOTH said "a after b" when both were blank.
  // A spec-compliant sort may return anything under that. It never misordered on
  // today's data, but it was true by luck.
  it("two blanks compare equal, so the sort stays stable", () => {
    expect(compareValues(null, undefined, "asc")).toBe(0);
    expect(compareValues(null, undefined, "desc")).toBe(0);
  });

  it("is antisymmetric across every pair of value kinds", () => {
    const kinds = [5, -5, 0, "b", "a", null, undefined, NaN, Infinity, -Infinity];
    for (const dir of ["asc", "desc"] as const) {
      for (const x of kinds) {
        for (const y of kinds) {
          const f = compareValues(x, y, dir);
          const r = compareValues(y, x, dir);
          expect(Number.isNaN(f)).toBe(false);
          // Summed rather than negated: Object.is(+0, -0) is false, and a tie
          // legitimately returns 0 from both directions.
          expect(Math.sign(f) + Math.sign(r)).toBe(0);
        }
      }
    }
  });

  it("treats NaN and Infinity as blanks, not as extreme values", () => {
    const rows = [{ id: "inf", v: Infinity }, { id: "real", v: 1 }, { id: "nan", v: NaN }];
    expect(order(rows, sortComparator("v", "desc"))[0]).toBe("real");
    expect(order(rows, sortComparator("v", "asc"))[0]).toBe("real");
  });

  it("orders numbers the obvious way", () => {
    expect(compareBy({ v: 2 }, { v: 1 }, "v", "desc")).toBeLessThan(0);
    expect(compareBy({ v: 2 }, { v: 1 }, "v", "asc")).toBeGreaterThan(0);
  });

  it("sorts a missing key as a blank rather than throwing", () => {
    const rows = [{ id: "has", v: 1 }, { id: "missing" }];
    expect(order(rows, sortComparator("v", "asc"))).toEqual(["has", "missing"]);
  });
});
