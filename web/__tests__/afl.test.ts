import { describe, expect, it } from "vitest";
import { profileHref, sampleTier, typeChanges } from "@/lib/afl";

describe("AFL helpers", () => {
  it("tiers on the site's pitch-count floors", () => {
    expect([sampleTier(400), sampleTier(399), sampleTier(150), sampleTier(50), sampleTier(49), sampleTier(null)])
      .toEqual(["HIGH", "MODERATE", "MODERATE", "LOW", "MINIMAL", "MINIMAL"]);
  });

  it("links the existing profile, MLB first", () => {
    expect(profileHref({ id: "1", page: "mlb" }, 2026)).toBe("/player/1");
    expect(profileHref({ id: "2", page: "minors" }, 2026)).toBe("/minors/player/2?season=2026");
    expect(profileHref({ id: "3", page: null })).toBeNull();
  });

  it("reports only changes past the display thresholds, HB arm-side for either hand", () => {
    const t = [{ type: "FF", n: 60, dVelo: 1.24, dUsage: 2, dIvb: 0.4, dHb: -2 }, { type: "SL", n: 30, dVelo: 0.2, dUsage: 1, dIvb: 1, dHb: 1 }];
    expect(typeChanges(t, "R")).toEqual(['FF +1.2 mph, +2.0" arm-side HB']); // RHP: pfx_x −2 is 2 in. more arm-side run
    expect(typeChanges(t, "L")).toEqual(['FF +1.2 mph, −2.0" arm-side HB']);
    expect(typeChanges(null, "R")).toEqual([]);
  });
});
