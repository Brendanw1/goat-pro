import { describe, expect, it } from "vitest";
import { getPitcherPercentileRank, getStatPercentileRank, isNeutralStat } from "@/lib/percentiles";

const bp = { p10: 20, p25: 24, p50: 28, p75: 32, p90: 36 };

describe("percentile direction", () => {
  it("ranks a hitter's low chase and whiff high, raw or sample-adjusted", () => {
    for (const k of ["oSwingPct", "oSwingPctShrunk", "chasePct", "whiffPct", "whiffPctShrunk"]) {
      expect(getStatPercentileRank(k, 21, bp), k).toBeGreaterThan(80);
    }
  });
  it("ranks a pitcher's high chase induced high", () => {
    expect(getPitcherPercentileRank("chasePct", 35, bp)).toBeGreaterThan(80);
  });
  it("keeps descriptive rows neutral under the Shrunk key", () => {
    expect(isNeutralStat("hitter", "swingPctShrunk")).toBe(true);
  });
});
