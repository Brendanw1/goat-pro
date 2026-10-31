import { describe, expect, it } from "vitest";
import { HEX_NX, HEX_S, hexCenter, smoothHex, sumHex } from "@/lib/zone-hex";

const one = (k: number, n: number) => ({ i: [k], n: [n], sw: [n], wh: [0], rv: [0], bip: [0], xw: [0], hd: [0] });

describe("zone hex lattice (mirrors web_export.py zone_hex)", () => {
  it("places centres: row 0 from -1.5, odd rows shifted half a hex", () => {
    expect(hexCenter(0)).toEqual([-1.5, 0.5]);
    expect(hexCenter(HEX_NX)[0]).toBeCloseTo(-1.5 + HEX_S / 2);
  });
  it("sums types/hands by hex and smooths with weight 1 at the centre", () => {
    const s = sumHex([one(40, 2), one(40, 3), one(41, 1)])!;
    expect(s.i).toEqual([40, 41]);
    expect(s.n).toEqual([5, 1]);
    const sm = smoothHex(one(40, 4), 0.2);
    expect(sm[0][40]).toBeCloseTo(4);
    expect(sm[0][41]).toBeLessThan(4);
    expect(sm[1][40] / sm[0][40]).toBeCloseTo(1); // ratio of separately smoothed num/den
  });
});
