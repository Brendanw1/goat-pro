"use client";
/**
 * Launch intro (home only, once per session): pixel-block GOAT assembles on the shaded field, "-PRO" slides in
 * from the right, the blocks break away and the overlay fades to the already-rendered home page (~1.7 s).
 *
 * The play/skip decision is an inline script that runs while the HTML is parsed, before first paint: it sets
 * <html data-intro="play"> only on "/", only once per tab session, never under prefers-reduced-motion. CSS shows
 * the overlay only in that state, so without JS (or on a repeat visit) nothing renders and nothing flashes.
 * The markup is static and deterministic (no Math.random), so it hydrates cleanly.
 */
import { useEffect } from "react";

const GLYPHS: Record<string, string[]> = {
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
};
const WORD = "GOAT";
const COLS = WORD.length * 6 - 1; // 5-wide glyphs, 1-block gaps
const TOTAL_MS = 1750;

// deterministic jitter in [-1, 1)
const jit = (n: number) => ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1 * 2 - 1;

const BLOCKS = WORD.split("").flatMap((ch, li) =>
  GLYPHS[ch].flatMap((row, y) =>
    row.split("").flatMap((c, x) => {
      if (c !== "#") return [];
      const gx = li * 6 + x, i = li * 100 + y * 5 + x;
      const vx = (gx - (COLS - 1) / 2) / ((COLS - 1) / 2), vy = (y - 3) / 3; // -1..1 from the word's centre
      return [{
        key: `${li}-${x}-${y}`, gx, y,
        style: {
          gridColumn: gx + 1, gridRow: y + 1,
          "--in": `${li * 55 + (x + y) * 14}ms`,
          "--out": `${Math.round(60 * Math.abs(vx) + 40 * (1 + jit(i)))}ms`,
          "--dx": (vx * 16 + jit(i + 1) * 5).toFixed(2),
          "--dy": (vy * 10 + jit(i + 2) * 5 + 7).toFixed(2), // outward, with a little fall
          "--rot": `${Math.round(jit(i + 3) * 240)}deg`,
        } as React.CSSProperties,
      }];
    })));

const DECIDE = `try{var d=document.documentElement;if(location.pathname==="/"&&!sessionStorage.getItem("goat-intro")&&!matchMedia("(prefers-reduced-motion: reduce)").matches){d.dataset.intro="play"}}catch(e){}`;

export function LaunchIntro() {
  useEffect(() => {
    const d = document.documentElement;
    if (d.dataset.intro !== "play") return;
    try { sessionStorage.setItem("goat-intro", "1"); } catch { /* private mode: replays, harmless */ }
    const done = () => { d.dataset.intro = "done"; };
    const t = setTimeout(done, TOTAL_MS);
    const skip = () => { d.dataset.intro = "skip-now"; setTimeout(done, 250); };
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => { clearTimeout(t); window.removeEventListener("keydown", skip); window.removeEventListener("pointerdown", skip); };
  }, []);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: DECIDE }} />
      <div className="launch" aria-hidden="true">
        <div className="launch-word">
          <div className="launch-grid" style={{ gridTemplateColumns: `repeat(${COLS}, var(--px))` }}>
            {BLOCKS.map((b) => <span key={b.key} className="launch-block" style={b.style} />)}
          </div>
          <span className="launch-pro">-PRO</span>
        </div>
      </div>
    </>
  );
}
