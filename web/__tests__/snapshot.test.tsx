import { describe, expect, it } from "vitest";
import { leafPanels, move } from "@/components/ui/snapshot";

describe("snapshot", () => {
  it("picks leaf panels inside main only", () => {
    document.body.innerHTML = `<nav><div class="glass-panel" id="n"></div></nav>
      <main><div class="glass-panel" id="wrap"><div class="glass-panel" id="a"></div><div class="glass-panel" id="b"></div></div>
      <div class="glass-panel" id="c"><div class="rounded-lg">card</div></div></main>`;
    expect(leafPanels(document).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("moves within bounds", () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
