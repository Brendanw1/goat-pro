import { describe, expect, it } from "vitest";
import { slotLabel } from "@/lib/arm-slot";

describe("slotLabel", () => {
  it("names each band at and across its cut points", () => {
    expect([65, 60, 59.9, 45, 30, 15, 0, -5].map(slotLabel)).toEqual(["Over the top", "Over the top", "High three-quarter",
      "High three-quarter", "Three-quarter", "Low three-quarter", "Sidearm", "Submarine"]);
  });
});
