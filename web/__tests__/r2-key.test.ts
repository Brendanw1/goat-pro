import { describe, expect, it } from "vitest";
import { badInput, fetchFromR2, safeKey, streamFromR2 } from "@/lib/r2";

describe("R2 key guard (security audit C1)", () => {
  it("accepts baked keys", () => {
    for (const k of ["players/660271.json", "boosters/whiff_SL_vs_RHH.json.gz", "rosters40/teams.json"]) expect(safeKey(k)).toBe(true);
  });
  it("refuses traversal and URL tricks", () => {
    for (const k of ["players/1-/../../x.json#", "a/../../b", "../x.json", "players/./x.json", "/players/x.json",
                     "players/x.json?list-type=2", "players/x%2e%2e.json", "players\\..\\x", "players//x.json", ""])
      expect(safeKey(k)).toBe(false);
  });
  it("readers answer a bad key with null before any fetch", async () => {
    expect(await fetchFromR2("players/1-/../../x.json#")).toBeNull();
    expect(await streamFromR2("a/../../b")).toBeNull();
  });
  it("routes 404 malformed ids and seasons", () => {
    expect(badInput("660271", "2025")).toBeNull();
    expect(badInput("660271", undefined, false)).toBeNull();
    for (const [id, s] of [["..%2Fplayers", "2025"], ["660271", "/../../x.json#"], ["660271", "25"], ["660271", null]] as const)
      expect(badInput(id, s)?.status).toBe(404);
  });
});
