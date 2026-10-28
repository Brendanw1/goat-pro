/**
 * Player pages wear the club's two colours instead of the site's green / gold (owner 2026-10-27). The site palette is
 * two CSS variables (--color-usf-green = fills and glows, --color-usf-gold = accents, borders and highlighted text),
 * so overriding them while the profile is mounted recolours every chip, pill, glow and the page fog at once. A
 * <style> tag applies on the server render (no green flash) and leaves with the page. Good/bad stat colours are
 * semantic and stay. Unknown team codes (minor league clubs) keep the site palette.
 */
import { teamColors } from "@/lib/team-pixel";

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};

export function TeamTheme({ team }: { team: string | null | undefined }) {
  const c = teamColors(team);
  if (!c) return null;
  const [dark, light] = luminance(c[0]) <= luminance(c[1]) ? c : [c[1], c[0]];
  // the accent role is read as text on a near-black page: lift a dark secondary (navy, black) toward white
  const accent = luminance(light) < 0.08 ? `color-mix(in oklch, ${light} 45%, white)` : light;
  return <style>{`:root{--color-usf-green:${dark};--color-usf-gold:${accent}}`}</style>;
}
