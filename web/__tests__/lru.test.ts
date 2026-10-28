import { describe, expect, it, vi } from "vitest";
import { lruGet } from "@/lib/lru";

/**
 * The Stuff+ and what-if model caches held every parsed booster for the life of
 * the tab (~4.8 MB of typed arrays each). They are capped at 3, least recently
 * used out first.
 */
describe("lruGet", () => {
  it("makes once per key and reuses the hit", () => {
    const c = new Map<string, number>(), make = vi.fn(() => 1);
    expect(lruGet(c, "a", 3, make)).toBe(1);
    expect(lruGet(c, "a", 3, make)).toBe(1);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("caps the map, evicting the least recently used", () => {
    const c = new Map<string, string>();
    for (const k of ["a", "b", "c"]) lruGet(c, k, 3, () => k);
    lruGet(c, "a", 3, () => "x");          // a is now the most recent
    lruGet(c, "d", 3, () => "d");          // evicts b, not a
    expect([...c.keys()]).toEqual(["c", "a", "d"]);
    expect(c.get("a")).toBe("a");
  });
});
