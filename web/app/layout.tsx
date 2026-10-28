import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Lato, Be_Vietnam_Pro } from "next/font/google";
import localFont from "next/font/local";
import { HoverTip } from "@/components/ui/hover-tip";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

/**
 * The two faces, self-hosted.
 *
 * These were a `<link>` to fonts.googleapis.com in `<head>`, which cost two
 * render-blocking round trips to a third party before first paint and left the
 * whole design falling back to `system-ui` whenever that host was slow or
 * blocked — on a data tool whose columns are set in a tabular-numerals face,
 * that fallback is not a cosmetic downgrade. `next/font` fetches at build time,
 * serves from our own origin, and emits `font-display: swap` with a size-matched
 * fallback so the swap does not shift the layout.
 *
 * `weight` is pinned to what the app actually sets: Lato at 300/400/700/900 and
 * Be Vietnam Pro at 300–700. Asking for the full family would ship faces nothing
 * references.
 */
const lato = Lato({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  display: "swap",
  variable: "--font-lato",
});

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-be-vietnam-pro",
});

/**
 * Wremena — the overlay heading, and nothing else.
 *
 * Roman Gornitsky / The Temporary State, 2017, free for commercial use and
 * catalogued as such by uncut.wtf. Checked before wiring rather than after: no
 * two of its glyphs share an outline, which is the test the previous candidate
 * failed while passing every codepoint check. app/fonts/README.md has the
 * reproduction.
 *
 * `preload: false` — one heading, inside an overlay most sessions never open.
 * Preloading would cost every visitor 41KB for text they will not see; `swap`
 * means the few who do open it see Lato for a frame rather than nothing.
 *
 * `adjustFontFallback: false` — Next has no metrics for a local face, and a
 * guessed size-match shifts the heading when the real font lands. Georgia is
 * named ahead of the generic serif in the CSS stack for the same reason: it is
 * the closest thing already on most machines.
 *
 * Serving the .woff rather than the .otf saves 21KB. A .woff2 would save ~10KB
 * more; the conversion needs brotli, which is not installed here.
 */
const wremena = localFont({
  src: "./fonts/Wremena-Regular.woff",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-wremena",
});

export const metadata: Metadata = {
  /*
   * A template, not a fixed string. Every one of the ten routes used to render
   * the identical title, so a browser tab, a bookmark and a history entry could
   * not tell the hitters leaderboard from the login page, and a screen reader
   * announced the same name on arrival at each — WCAG 2.4.2. Each page now sets
   * its own `title`; `default` covers the ones with nothing specific to say.
   */
  title: {
    default: "GOAT-Pro — MLB & AAA pitching and hitting research",
    template: "%s — GOAT",
  },
  description: "Public-data baseball research: validated pitch and hitter models, Statcast measurement and season projections for MLB and AAA.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${lato.variable} ${beVietnamPro.variable} ${wremena.variable}`}>
      <body>
        {/* Atmospheric fog background */}
        <div className="fog-bg" aria-hidden="true" />
        <Providers>{children}</Providers>
        <HoverTip />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
