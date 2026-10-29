/**
 * Retro pixel team badge: the team code in a 3x5 pixel font on a dithered
 * colour block, drawn as SVG rects with crisp edges so it scales blockily on
 * purpose. Deterministic — the same team always renders the same sprite (the
 * dither pattern is hashed off the code), nothing loads, nothing external.
 */
import { logoUrl, teamPixels } from "@/lib/team-pixel";

/**
 * 5-row uppercase pixel font, rows top→bottom. Mostly 3 bits wide; M, W and N
 * get 5 and 4 so they read as letters instead of as H and lowercase-n — the
 * whole reason several team codes (MIA, MIL, MIN, NYM, NYY, WSH) exist.
 */
const FONT: Record<string, { w: number; rows: number[] }> = {
  A: { w: 3, rows: [0b010, 0b101, 0b111, 0b101, 0b101] },
  B: { w: 3, rows: [0b110, 0b101, 0b110, 0b101, 0b110] },
  C: { w: 3, rows: [0b011, 0b100, 0b100, 0b100, 0b011] },
  D: { w: 3, rows: [0b110, 0b101, 0b101, 0b101, 0b110] },
  E: { w: 3, rows: [0b111, 0b100, 0b110, 0b100, 0b111] },
  F: { w: 3, rows: [0b111, 0b100, 0b110, 0b100, 0b100] },
  G: { w: 3, rows: [0b011, 0b100, 0b101, 0b101, 0b011] },
  H: { w: 3, rows: [0b101, 0b101, 0b111, 0b101, 0b101] },
  I: { w: 3, rows: [0b111, 0b010, 0b010, 0b010, 0b111] },
  J: { w: 3, rows: [0b011, 0b001, 0b001, 0b101, 0b010] },
  K: { w: 3, rows: [0b101, 0b101, 0b110, 0b101, 0b101] },
  L: { w: 3, rows: [0b100, 0b100, 0b100, 0b100, 0b111] },
  M: { w: 5, rows: [0b10001, 0b11011, 0b10101, 0b10001, 0b10001] },
  N: { w: 4, rows: [0b1001, 0b1101, 0b1011, 0b1001, 0b1001] },
  O: { w: 3, rows: [0b010, 0b101, 0b101, 0b101, 0b010] },
  P: { w: 3, rows: [0b110, 0b101, 0b110, 0b100, 0b100] },
  Q: { w: 3, rows: [0b010, 0b101, 0b101, 0b010, 0b001] },
  R: { w: 3, rows: [0b110, 0b101, 0b110, 0b101, 0b101] },
  S: { w: 3, rows: [0b111, 0b100, 0b110, 0b001, 0b111] },
  T: { w: 3, rows: [0b111, 0b010, 0b010, 0b010, 0b010] },
  U: { w: 3, rows: [0b101, 0b101, 0b101, 0b101, 0b111] },
  V: { w: 3, rows: [0b101, 0b101, 0b101, 0b101, 0b010] },
  W: { w: 5, rows: [0b10001, 0b10001, 0b10101, 0b11011, 0b10001] },
  X: { w: 3, rows: [0b101, 0b101, 0b010, 0b101, 0b101] },
  Y: { w: 3, rows: [0b101, 0b101, 0b010, 0b010, 0b010] },
  Z: { w: 3, rows: [0b111, 0b001, 0b010, 0b100, 0b111] },
};

/** Deterministic little hash for the dither pattern. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function PixelTeamLogo({ team, size = 18, className = "" }: { team: string | null | undefined; size?: number; className?: string }) {
  const colors = teamPixels(team);
  if (!colors) return null;
  const code = (team ?? "").toUpperCase().slice(0, 3);
  const { bg, ink } = colors;

  // Grid: 1px sprite border (corners notched), 1px padding, monogram, 1px padding.
  const widths = [...code].map((ch) => FONT[ch]?.w ?? 3);
  const textW = widths.reduce((a, b) => a + b, 0) + (code.length - 1);
  const W = textW + 4;
  const H = 9;
  const rects: { x: number; y: number; c: string }[] = [];
  const put = (x: number, y: number, c: string) => rects.push({ x, y, c });

  // Border ring with notched corners, in ink.
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) {
      const notch = (x === 0 || x === W - 1);
      if (!notch) put(x, y, ink);
    }
  }
  for (let y = 1; y < H - 1; y++) {
    put(0, y, ink);
    put(W - 1, y, ink);
  }
  // Fill
  for (let x = 1; x < W - 1; x++) {
    for (let y = 1; y < H - 1; y++) put(x, y, bg);
  }
  // Deterministic dither: a few darker pixels bottom-right, lighter top-left.
  const h = hash(code);
  const shade = "rgba(0,0,0,0.35)";
  const lite = "rgba(255,255,255,0.18)";
  for (let i = 0; i < 4; i++) {
    const x = 2 + ((h >> (i * 3)) % Math.max(1, textW + 1));
    put(x, H - 2, shade);
    const x2 = 2 + ((h >> (7 + i * 3)) % Math.max(1, textW + 1));
    put(x2, 1, lite);
  }
  // Monogram, centered.
  const startX = 2 + Math.floor((textW - widths.reduce((a, b) => a + b, 0) - (code.length - 1)) / 2);
  const startY = 2;
  let pen = startX;
  for (let li = 0; li < code.length; li++) {
    const glyph = FONT[code[li]];
    if (!glyph) { pen += 3 + (li < code.length - 1 ? 1 : 0); continue; }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < glyph.w; col++) {
        if ((glyph.rows[row] >> (glyph.w - 1 - col)) & 1) put(pen + col, startY + row, ink);
      }
    }
    pen += glyph.w + (li < code.length - 1 ? 1 : 0);
  }

  return (
    <svg
      width={(size * W) / H}
      height={size}
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${team} logo`}
      className={className}
      style={{ imageRendering: "pixelated", display: "inline-block", verticalAlign: "middle" }}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={1} height={1} fill={r.c} />
      ))}
    </svg>
  );
}

/** The club's cap logo when we have it, else the pixel badge. */
export function TeamCrest({ team, size = 14 }: { team: string | null | undefined; size?: number }) {
  const crest = logoUrl(team ?? undefined);
  // eslint-disable-next-line @next/next/no-img-element
  return crest ? <img src={crest} alt="" width={size} height={size} className="rounded shrink-0" /> : <PixelTeamLogo team={team} size={size - 1} />;
}
