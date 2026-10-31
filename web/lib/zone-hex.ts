/**
 * The Smooth zone view's lattice and kernel (pipeline/web_export.py zone_hex mirrors the lattice).
 * Raw counts are baked per hex; smoothing happens here so the bandwidth can change in the browser.
 * Pointy-top hexes: centres HEX_S ft apart in a row, rows HEX_DY apart, odd rows shifted half a hex;
 * x = batter frame (+ = his inside), z = normalized zone height (his zone always 1.5–3.5).
 */
export const HEX_S = 0.1;
export const HEX_DY = (HEX_S * Math.sqrt(3)) / 2;
export const HEX_NX = 31;
export const HEX_NY = Math.floor(4.0 / HEX_DY) + 1;
export const HEX_COLS = ["n", "sw", "wh", "rv", "bip", "xw", "hd"] as const;

/** One sparse surface: hex indices and the summed columns, aligned. */
export type HexCols = { i: number[] } & Record<(typeof HEX_COLS)[number], number[]>;

export function hexCenter(k: number): [number, number] {
  const j = Math.floor(k / HEX_NX), i = k % HEX_NX;
  return [-1.5 + i * HEX_S + (j % 2 ? HEX_S / 2 : 0), 0.5 + j * HEX_DY];
}

/** Pitch groups as unions of exact site types ('' = everything, untyped 'X' included). */
export const SPLIT_TYPES: Record<string, string[]> = {
  "": ["FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS", "X"],
  FB: ["FF", "SI", "CT"], BR: ["SL", "SW", "CB"], OS: ["CH", "FS"],
};
export const typesOf = (split: string) => SPLIT_TYPES[split] ?? [split];

/** Sum sparse surfaces (types into a group, hands into All). */
export function sumHex(parts: (HexCols | undefined | null)[]): HexCols | null {
  const acc = new Map<number, number[]>();
  for (const p of parts) {
    if (!p) continue;
    p.i.forEach((k, r) => {
      const a = acc.get(k) ?? new Array(HEX_COLS.length).fill(0);
      HEX_COLS.forEach((c, ci) => { a[ci] += p[c][r]; });
      acc.set(k, a);
    });
  }
  if (!acc.size) return null;
  const keys = [...acc.keys()].sort((a, b) => a - b);
  const out = { i: keys } as HexCols;
  HEX_COLS.forEach((c, ci) => { out[c] = keys.map((k) => acc.get(k)![ci]); });
  return out;
}

/**
 * Gaussian kernel smoothing of every column onto every lattice hex: numerator and denominator are
 * smoothed separately (the caller takes ratios), so a ratio is a kernel-weighted pooled rate.
 * Returns per lattice hex the 7 smoothed sums (n, sw, wh, rv, bip, xw, hd). Cutoff 3 bandwidths.
 */
export function smoothHex(src: HexCols, bw: number): Float64Array[] {
  const N = HEX_NX * HEX_NY, out = HEX_COLS.map(() => new Float64Array(N));
  const cx = src.i.map((k) => hexCenter(k)[0]), cz = src.i.map((k) => hexCenter(k)[1]);
  const cut2 = 9 * bw * bw, inv = 1 / (2 * bw * bw);
  for (let k = 0; k < N; k++) {
    const [x, z] = hexCenter(k);
    for (let r = 0; r < cx.length; r++) {
      const dx = x - cx[r], dz = z - cz[r], d2 = dx * dx + dz * dz;
      if (d2 > cut2) continue;
      const w = Math.exp(-d2 * inv);
      for (let c = 0; c < HEX_COLS.length; c++) out[c][k] += w * src[HEX_COLS[c]][r];
    }
  }
  return out;
}

/** p-th percentile (0–1) of a list, linear between ranks. */
export function quantile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), h = (s.length - 1) * p, lo = Math.floor(h);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (h - lo);
}
