/** Owner 2026-10-06: "we can't actually measure ssw" — no SSW filter or badge anywhere on the site. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const FILES = ["app/(dashboard)/pitchers/table.tsx", "lib/boards/pitchers.ts", "lib/boards/arsenal.ts", "lib/boards/shared.ts",
  "app/(dashboard)/arsenal/[pitch]/expanded.tsx", "app/(dashboard)/player/[id]/profile-view.tsx", "lib/data.ts", "types/index.ts"];

describe("SSW removed", () => {
  it.each(FILES)("%s has no SSW proxy filter, field or badge", (f) => {
    expect(readFileSync(f, "utf8")).not.toMatch(/SswProxy|>SSW<|SSW Proxy/);
  });
});
