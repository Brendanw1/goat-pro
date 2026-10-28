import { describe, expect, it } from "vitest";
import { tipLines } from "@/components/ui/hover-tip";

describe("tipLines", () => {
  it("keeps plain text as one block, whole", () => {
    expect(tipLines("95% interval 105.2 to 112.8 on 28 graded pitches")).toEqual(["95% interval 105.2 to 112.8 on 28 graded pitches"]);
  });
  it("splits a · list into a heading and detail lines, dropping nothing", () => {
    const t = "3-1 · FF 92.3 mph · called strike";
    expect(tipLines(t)).toEqual(["3-1", "FF 92.3 mph", "called strike"]);
    expect(tipLines(t).join(" · ")).toBe(t);
  });
  it("does not split a middle dot without spaces", () => {
    expect(tipLines("a·b")).toEqual(["a·b"]);
  });
});
