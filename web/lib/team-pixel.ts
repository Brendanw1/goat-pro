/**
 * Team colours for the pixel badges. MLB Stats API abbreviations (what the
 * pipeline bakes on `team`), primary as the badge fill and secondary as the
 * pixel-ink; aliases included for codes that changed (OAK→ATH, ARI/AZ). An
 * unknown code falls back to the neutral site palette — never to a guessed
 * colour. Ink drops back to white when the accent is too close to the fill.
 */
interface TeamPixels { bg: string; ink: string }

const RAW: Record<string, [string, string]> = {
  ARI: ["#A71930", "#E3D5A9"], AZ: ["#A71930", "#E3D5A9"],
  ATL: ["#13274F", "#CE1141"],
  BAL: ["#000000", "#DF4601"],
  BOS: ["#0C2340", "#BD3039"],
  CHC: ["#0E3386", "#CC3433"],
  CWS: ["#27251F", "#C4CED4"],
  CIN: ["#C6011F", "#FFFFFF"],
  CLE: ["#00385D", "#E50022"],
  COL: ["#33006F", "#C4CED4"],
  DET: ["#0C2340", "#FA4616"],
  HOU: ["#002D62", "#EB6E1F"],
  KC: ["#004687", "#BD9B60"],
  LAA: ["#BA0021", "#003263"],
  LAD: ["#005A9C", "#FFFFFF"],
  MIA: ["#00A3E0", "#EF3340"],
  MIL: ["#12284B", "#FFC52F"],
  MIN: ["#002B5C", "#D31145"],
  NYM: ["#002D72", "#FF5910"],
  NYY: ["#003087", "#E4002C"],
  ATH: ["#003831", "#EFB21E"],
  OAK: ["#003831", "#EFB21E"],
  PHI: ["#E81828", "#FFFFFF"],
  PIT: ["#27251F", "#FDB827"],
  SD: ["#2F241D", "#FFC425"],
  SEA: ["#0C2C56", "#005C5C"],
  SF: ["#27251F", "#FD5A1E"],
  STL: ["#C41E3A", "#FED141"],
  TEX: ["#003278", "#C0111F"],
  TOR: ["#134A8E", "#1D2D5C"],
  WSH: ["#AB0003", "#14225A"],
};

export const FALLBACK_TEAM: TeamPixels = { bg: "#2A2F2E", ink: "#D9DEDC" };

/**
 * The club's real cap logo, served from /public/logos (fetched once from MLB
 * static by the bake and committed — the durable store; also mirrored to R2
 * under goatpro/logos/). Codes whose file was not fetched return null and the
 * caller falls back to the pixel badge.
 */
export function logoUrl(team: string | null | undefined): string | null {
  if (!team) return null;
  const code = team.toUpperCase();
  // Files exist for every fetched code; the aliases whose file carries the
  // current abbreviation resolve through the alias map's canonical code.
  const canonical: Record<string, string> = { ARI: "AZ", OAK: "ATH" };
  const file = canonical[code] ?? code;
  return file in RAW ? `/logos/${file}.svg` : null;
}

/** The club's raw primary / secondary pair (no badge-ink substitution); null for an unknown code. */
export function teamColors(team: string | null | undefined): [string, string] | null {
  return team ? RAW[team.toUpperCase()] ?? null : null;
}

export function teamPixels(team: string | null | undefined): TeamPixels | null {
  if (!team) return null;
  const raw = RAW[team.toUpperCase()];
  if (!raw) return FALLBACK_TEAM;
  const [bg, ink] = raw;
  // Ink must read against the fill on a dark site; when the accent is as dark
  // as the fill, white carries the monogram instead.
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c: number) => { const v = (c / 255) <= 0.04045 ? (c / 255) / 12.92 : ((c / 255) + 0.055) / 1.055 ** 2.4; return v; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  return Math.abs(lum(bg) - lum(ink)) < 0.10 ? { bg, ink: "#F0F2F4" } : { bg, ink };
}
