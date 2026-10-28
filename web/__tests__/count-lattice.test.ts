import { describe, expect, it } from "vitest";
import { bakedSides, countFlow, LATTICE_EDGES } from "@/lib/count-lattice";

describe("count lattice", () => {
  it("has 17 edges and reads edge flow off the baked calls", () => {
    expect(LATTICE_EDGES).toHaveLength(17);
    const f = countFlow({ pa: 10, c: { "0-0": { n: 10, pa: 10, m: [["FF", 6], ["SL", 4]], b: 3, s: 6 }, "0-1": { n: 6, pa: 6, m: [["SL", 6]], b: 2, s: 3 } } });
    expect(f.edges.find((e) => e.from === "0-0" && e.to === "1-0")!.n).toBe(3);
    expect(f.edges.find((e) => e.from === "0-0" && e.to === "0-1")!.n).toBe(6);
    expect(f.nodes.find((n) => n.count === "0-1")!.reaching).toBe(6);
    expect(f.nodes[0].mix[0]).toMatchObject({ pitchType: "FF", pct: 60 });
    expect(f.plateAppearances).toBe(10);
  });
  it("reads the old flat bake as Overall with inflow reach", () => {
    const s = bakedSides({ "0-0": { n: 4, m: [["FF", 4]], b: 1, s: 2 } });
    expect(Object.keys(s)).toEqual(["all"]);
    const f = countFlow(s.all);
    expect(f.nodes.find((n) => n.count === "0-1")!.reaching).toBe(2);
    expect(f.plateAppearances).toBe(4);
  });
});
