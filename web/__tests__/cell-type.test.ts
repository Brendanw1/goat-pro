import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CELL_TYPE, PITCH_CONFIG } from "@/lib/constants";
import { baseCode } from "@/types";

// The game report's Stuff+ column reads grades by CELL_TYPE[code]. When the
// cells' names and this map drift apart the column goes blank with no error
// (it did, 2026-09-30), so pin both sides.
const FILE = path.resolve(__dirname, "../../data/export/stuff_games.json");

describe("CELL_TYPE", () => {
  it("covers every graded pitch code", () => {
    for (const code of Object.keys(PITCH_CONFIG).filter((c) => baseCode(c) !== "KN")) expect(CELL_TYPE[code], code).toBeTruthy();
  });

  it("names a repeat group after its base type", () => {
    expect(CELL_TYPE.SL2).toBe("Slider 2");
    expect(CELL_TYPE.SW).toBe("Sweeper");
    expect(PITCH_CONFIG.SL2).toEqual({ ...PITCH_CONFIG.SL, label: "Slider 2", shortLabel: "SL2" });
  });

  it.skipIf(!existsSync(FILE))("maps to names the per-game Stuff+ cells actually use", () => {
    const games = JSON.parse(readFileSync(FILE, "utf8")).games as Record<string, Record<string, { c: { t: string }[] }>>;
    const names = new Set<string>();
    for (const g of Object.values(games)) for (const v of Object.values(g)) for (const c of v.c) names.add(c.t);
    for (const [code, name] of Object.entries(CELL_TYPE).filter(([c]) => c === baseCode(c))) expect(names.has(name), `${code} -> ${name}`).toBe(true);
  });
});
