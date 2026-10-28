import { describe, expect, it } from "vitest";
import { vaaZoneRows, type VaaZoneFile } from "@/lib/vaa-zone";

const q = Array.from({ length: 99 }, (_, i) => -8 + (i + 1) * 0.04); // p1..p99 from -7.96 to -4.04
const file: VaaZoneFile = {
  season: "2026",
  floor: 15,
  direction: { FF: { high: 1, mid: 1, low: -1 }, SL: { high: 1, mid: 1, low: 0 } },
  cells: { FF: { "high-arm": { q, n: 100 }, "low-arm": { q, n: 100 } }, SL: { "low-mid": { q, n: 100 } } },
};
const cell = (pitchType: string, zone_z: string, zone_x: string, avg_vaa: number, n = 20) => ({ pitchType, zone_x, zone_z, avg_vaa, n });

describe("vaaZoneRows", () => {
  it("ranks flatness where flatter is good, inverts where steeper is, greys descriptive rows", () => {
    const out = vaaZoneRows(file, [cell("FF", "low", "arm", -5), cell("FF", "high", "arm", -5), cell("SW", "low", "mid", -5)]);
    const [hi, lo] = out.FF;
    expect(hi.key).toBe("high-arm"); // grid order, not input order
    expect(hi.rank).toBe(75);
    expect(lo.rank).toBe(25);        // flatter than 75% on a steeper-is-good row = 25th
    expect(out.SW[0]).toMatchObject({ rank: 75, neutral: true }); // Sweeper ranks in the SL pool, grey low
    expect([hi.note, lo.note, out.SW[0].note]).toEqual(["flatter better", "steeper better", "no verdict"]);
  });
  it("under the floor: ranked off the raw VAA as small-sample from 5 pitches, n only under 5; no rank without peers", () => {
    const out = vaaZoneRows(file, [cell("FF", "high", "arm", -5, 12), cell("FF", "mid", "mid", -5)]);
    expect(out.FF[0]).toMatchObject({ rank: 75, n: 12, floor: 15 });
    expect(vaaZoneRows(file, [cell("FF", "high", "arm", -5, 4)]).FF[0]).toMatchObject({ rank: null, n: 4, floor: undefined });
    expect(vaaZoneRows(file, [cell("FF", "high", "arm", -5, 15)]).FF[0]).toMatchObject({ rank: 75, n: null, floor: undefined });
    expect(out.FF[1]).toMatchObject({ rank: null, n: null });
    expect(vaaZoneRows(null, [cell("FF", "high", "arm", -5)]).FF[0].rank).toBeNull();
  });
});
