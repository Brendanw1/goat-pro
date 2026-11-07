import { describe, expect, it } from "vitest";
import { PQ_LOW_HEX, PQ_NULL_TIP, pqColor, pqMarker, pqTitle } from "@/lib/pitch-quality";
import { ARSENAL_ROW_KEYS, COLS, queryArsenal, ARSENAL_DEFAULTS } from "@/lib/boards/arsenal";
import { gradeColor } from "@/lib/grades";

describe("Pitch Quality display", () => {
  it("colours on the 100-centred ladder shifted by 50, muted when not confident", () => {
    expect(pqColor(70)).toBe(gradeColor(120));
    expect(pqColor(60)).toBe(gradeColor(110));
    expect(pqColor(50)).toBeUndefined();
    expect(pqColor(25)).toBe(gradeColor(75));
    expect(pqColor(70, "low")).toBe(PQ_LOW_HEX);
    expect(pqColor(null)).toBeUndefined();
  });

  it("marks provisional, limited and low tiers only", () => {
    expect(pqMarker("full")).toBeNull();
    expect(pqMarker("provisional")).toBe("prov");
    expect(pqMarker("limited")).toBe("limited");
    expect(pqMarker("low")).toBe("not confident");
  });

  it("says why a cell is empty, low, or which scale an AAA grade is on", () => {
    expect(pqTitle({ pitchQuality: null })).toBe(PQ_NULL_TIP);
    expect(pqTitle({ pitchQuality: 55, pitchQualityTier: "low", n_pitches: 80, pitchQualityNeed: 150 }))
      .toContain("graded from 150");
    const mlb = pqTitle({ pitchQuality: 60, pitchQualityTier: "full", pitchQualityClaim: "describes", n_pitches: 300 });
    expect(mlb).toBe("describes · 300 pitches");
    expect(pqTitle({ pitchQuality: 60, pitchQualityTier: "full", pitchQualityMlb: 55 }, true)).toContain("55 on the MLB scale");
    expect(pqTitle({ pitchQuality: 60, pitchQualityTier: "full" }, true)).toContain("failed the scale check");
  });

  it("is a sortable arsenal board column that carries its tier", () => {
    expect(COLS.some((c) => c.key === "pitchQuality")).toBe(true);
    expect(ARSENAL_ROW_KEYS).toEqual(expect.arrayContaining(["pitchQuality", "pitchQualityTier", "pitchQualityClaim"]));
    const rows = [{ id: "1", season: 2026, pitchQuality: 45 }, { id: "2", season: 2026, pitchQuality: 70 }, { id: "3", season: 2026, pitchQuality: null }];
    const page = queryArsenal(rows, { ...ARSENAL_DEFAULTS, sortBy: "pitchQuality", sortDir: "desc" });
    expect(page.rows.map((r: any) => r.id)).toEqual(["2", "1", "3"]);
  });
});
