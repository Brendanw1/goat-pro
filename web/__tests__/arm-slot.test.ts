import { describe, expect, it } from "vitest";
import { armSideHb, slotLabel } from "@/lib/arm-slot";

describe("slotLabel", () => {
  it("names each band at and across its cut points", () => {
    expect([65, 60, 59.9, 45, 30, 15, 0, -5].map(slotLabel)).toEqual(["Over the top", "Over the top", "High three-quarter",
      "High three-quarter", "Three-quarter", "Low three-quarter", "Sidearm", "Submarine"]);
  });
});

describe("armSideHb", () => {
  // baked hb = Statcast pfx_x·12 (catcher's view); values from the 2025 player files
  it("puts a RHP sinker and a LHP changeup arm side (+), sweepers glove side (−)", () => {
    expect(armSideHb(-15.7, "R")).toBe(15.7);  // Webb SI
    expect(armSideHb(14.6, "R")).toBe(-14.6);  // Webb SW
    expect(armSideHb(15.0, "L")).toBe(15.0);   // Skubal CH
    expect(armSideHb(-4.9, "L")).toBe(-4.9);   // Skubal CB
  });
  it("refuses to guess an unknown hand or a missing value", () => {
    expect(armSideHb(5, null)).toBeNull();
    expect(armSideHb(5, "S")).toBeNull();
    expect(armSideHb(null, "R")).toBeNull();
  });
});
