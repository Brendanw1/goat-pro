import { describe, expect, it } from "vitest";
import { applyFilters, decodeFilters, encodeFilters, kindOf, rangeOf, type FilterColumn } from "@/lib/column-filters";

const COLS: FilterColumn[] = [
  { key: "stuffPlus", label: "Stuff+", group: "Models" },
  { key: "velo", label: "Velo", group: "Results" },
  { key: "year", label: "Class", group: "Context" },
  { key: "name", label: "Name", group: "Context" },
  { key: "abStuffPlus", label: "ABStuff+", group: "Models" },
];
const rows = [
  { name: "A", stuffPlus: 115, velo: 93.4, year: "Jr" },
  { name: "B", stuffPlus: 98, velo: 88.1, year: "Fr" },
  { name: "C", stuffPlus: null, velo: 95.0, year: "Sr" },
  { name: "D", stuffPlus: 121, velo: 97.2, year: "Jr" },
];

describe("column filters", () => {
  it("picks the control from the data", () => {
    expect(kindOf(rows, COLS[0])).toBe("number");
    expect(kindOf(rows, COLS[2])).toBe("category");
    expect(rangeOf(rows, COLS[1])).toEqual({ min: 88.1, max: 97.2 });
  });
  it("applies min, max and category filters, and hides blanks while filtered", () => {
    expect(applyFilters(rows, [{ key: "stuffPlus", min: 110 }], COLS).map((r) => r.name)).toEqual(["A", "D"]);
    expect(applyFilters(rows, [{ key: "velo", min: 92, max: 96 }], COLS).map((r) => r.name)).toEqual(["A", "C"]);
    expect(applyFilters(rows, [{ key: "year", values: ["Jr", "Sr"] }], COLS).map((r) => r.name)).toEqual(["A", "C", "D"]);
    expect(applyFilters(rows, [{ key: "stuffPlus", max: 200 }], COLS).map((r) => r.name)).toEqual(["A", "B", "D"]); // C blank
    expect(applyFilters(rows, [{ key: "stuffPlus" }], COLS)).toHaveLength(4);   // added but empty = no constraint
  });
  it("filters and round-trips ABStuff+ (abStuffPlus:110~)", () => {
    const data = [{ name: "A", abStuffPlus: 115 }, { name: "B", abStuffPlus: 98 }, { name: "C", abStuffPlus: null }];
    expect(applyFilters(data, [{ key: "abStuffPlus", min: 110 }], COLS).map((r) => r.name)).toEqual(["A"]);
    expect(encodeFilters([{ key: "abStuffPlus", min: 110 }])).toBe("abStuffPlus:110~");
    expect(decodeFilters("abStuffPlus:110~")).toEqual([{ key: "abStuffPlus", min: 110 }]);
  });
  it("round-trips through the URL", () => {
    const f = [{ key: "stuffPlus", min: 110 }, { key: "velo", min: 92, max: 97 }, { key: "era", max: 3.5 }, { key: "year", values: ["Jr", "Sr"] }];
    const s = encodeFilters(f);
    expect(s).toBe("stuffPlus:110~;velo:92~97;era:~3.5;year=Jr|Sr");
    expect(decodeFilters(s)).toEqual(f);
    expect(decodeFilters("bad;;x:~")).toEqual([]);
  });
});
