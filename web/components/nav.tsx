"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "@/components/search";
import { LavaNav } from "@/components/ui/lava-bar";
import { RESEARCH_SECTIONS } from "@/lib/research-sections";

const NAV_ITEMS = [
  { href: "/pitchers", label: "Pitchers" },
  { href: "/hitters", label: "Hitters" },
  { href: "/minors", label: "Minors" },
  { href: "/prospects", label: "Prospects" },
  { href: "/teams", label: "Teams" },
  { href: "/trades", label: "Trades" },
  { href: "/postseason", label: "Postseason" },
  { href: "/matchup", label: "Matchup" },
  { href: "/arsenal", label: "Arsenal" },
  { href: "/defense", label: "Defense" },
  { href: "/hoops", label: "Hoops" },
  { href: "/research", label: "Research" },
  { href: "/glossary", label: "Glossary" },
  // past the fade: scroll the strip to reach these
  { href: "/reports/projections", label: "Projections" },
  { href: "/rosters", label: "40-man" },
  { href: "/dong", label: "Would it dong" },
  { href: "/roles", label: "Roles" },
  { href: "/framing", label: "Framing" },
  { href: "/wpa", label: "WPA" },
  { href: "/abs", label: "ABS" },
  { href: "/scouting/savant", label: "Savant boards" },
] as const;

/* Baseball seams for the badge, traced from the owner's reference (pngtree
   "3D baseball on transparent background"): the front-on view, one seam
   smiling across the upper face and one frowning across the lower face,
   both running off the rim, with V-stitches straddling each seam. The ball
   fills the whole badge. Owner revision: each seam is mirrored within its own
   band so it bows out toward the rim (clear of the wordmark), the stitches are
   diagonal V pairs every 2.5 units with the seam line down their middle, run past the rim so the clip ends them right at the edge, the top seam's right half eased out toward the rim to clear the T, and
   the whole set is faded so GOAT / PRO read first. Precomputed literals. */
const SEAM_PATHS = [
  "M-1.7 14.4 L-0.9 14.0 L-0.0 13.6 L0.8 13.2 L1.7 12.8 L2.5 12.4 L3.4 12.0 L4.2 11.6 L5.0 11.2 L5.9 10.7 L6.7 10.3 L7.5 9.8 L8.3 9.3 L9.1 8.9 L9.9 8.4 L10.7 7.9 L11.5 7.4 L12.3 6.9 L13.1 6.5 L14.0 6.1 L14.8 5.6 L15.7 5.3 L16.6 5.1 L17.5 4.8 L18.4 4.6 L19.3 4.4 L20.2 4.3 L21.2 4.2 L22.1 4.2 L23.0 4.3 L23.9 4.4 L24.9 4.5 L25.8 4.7 L26.7 5.0 L27.6 5.3 L28.4 5.7 L29.3 6.0 L30.2 6.3 L31.1 6.6 L31.9 6.9 L32.8 7.2 L33.7 7.4 L34.6 7.7 L35.5 8.1 L36.3 8.6 L37.1 9.0 L38.0 9.4 L38.8 9.9 L39.5 10.4 L40.3 10.9 L41.0 11.5 L41.8 12.1 L42.5 12.7 L43.2 13.3 L43.8 14.0 L44.4 14.7 L45.0 15.4 L45.7 16.1 L46.3 16.8 L47.0 17.5",
  "M-1.5 31.9 L-0.7 32.4 L0.1 32.8 L0.9 33.3 L1.6 33.8 L2.4 34.3 L3.2 34.7 L4.0 35.2 L4.8 35.7 L5.6 36.1 L6.4 36.5 L7.2 36.9 L8.0 37.3 L8.8 37.7 L9.7 38.1 L10.5 38.5 L11.3 38.9 L12.1 39.3 L13.0 39.6 L13.8 39.9 L14.7 40.2 L15.5 40.5 L16.4 40.7 L17.3 40.9 L18.2 41.1 L19.1 41.2 L20.0 41.3 L20.9 41.4 L21.8 41.4 L22.7 41.5 L23.6 41.4 L24.6 41.4 L25.5 41.3 L26.4 41.3 L27.3 41.2 L28.2 41.0 L29.1 40.9 L30.0 40.7 L30.8 40.5 L31.7 40.3 L32.6 40.0 L33.4 39.7 L34.3 39.3 L35.1 38.9 L35.9 38.5 L36.8 38.1 L37.6 37.7 L38.4 37.3 L39.2 36.9 L40.0 36.5 L40.8 36.0 L41.6 35.6 L42.3 35.1 L43.1 34.6 L43.9 34.1 L44.7 33.7 L45.5 33.2 L46.2 32.7 L47.0 32.2 L47.8 31.8",
] as const;

const SEAM_STITCHES = [
  "M3.3 12.5L3.1 14.2M2.9 11.7L1.4 10.8M5.7 11.4L5.4 13.1M5.3 10.6L3.7 9.7M7.9 10.1L7.9 11.9M7.5 9.3L5.9 8.6M9.9 8.9L9.7 10.7M9.5 8.1L7.9 7.3M12.1 7.6L12.1 9.3M11.7 6.8L10.1 6.1M14.4 6.3L14.3 8.1M13.9 5.6L12.3 4.9M16.5 5.6L15.9 7.2M16.2 4.7L14.8 3.6M18.9 5.0L18.3 6.6M18.7 4.1L17.5 2.9M21.4 4.7L20.4 6.1M21.4 3.8L20.4 2.3M23.7 4.9L22.5 6.2M23.8 4.0L22.9 2.4M26.1 5.3L24.7 6.3M26.4 4.4L25.9 2.7M28.5 6.2L26.9 7.1M28.8 5.3L28.5 3.6M30.9 7.1L29.5 8.1M31.2 6.2L30.7 4.5M33.2 7.7L31.8 8.8M33.4 6.9L32.9 5.2M35.4 8.6L33.8 9.3M35.9 7.9L35.8 6.1M37.7 9.8L36.1 10.5M38.2 9.0L38.1 7.3M39.7 11.0L38.0 11.6M40.2 10.3L40.2 8.5M41.7 12.6L40.0 13.1M42.2 11.9L42.4 10.1M43.4 14.3L41.7 14.5M44.1 13.8L44.6 12.1M45.0 16.1L43.3 16.3M45.7 15.5L46.1 13.7M46.8 17.9L45.1 18.2M47.5 17.3L47.8 15.6",
  "M3.0 35.1L1.5 36.0M3.4 34.3L3.2 32.6M5.1 36.4L3.6 37.3M5.6 35.6L5.3 33.9M7.4 37.5L5.9 38.4M7.8 36.7L7.5 35.0M9.7 38.6L8.2 39.5M10.1 37.7L9.7 36.0M12.0 39.7L10.5 40.7M12.3 38.8L11.9 37.1M14.3 40.5L12.7 41.4M14.7 39.7L14.4 38.0M16.8 41.3L15.5 42.5M17.0 40.4L16.3 38.7M19.3 41.6L18.1 42.9M19.4 40.7L18.6 39.2M21.8 41.9L20.8 43.3M21.8 40.9L20.8 39.5M24.1 41.8L23.2 43.3M24.1 41.0L23.0 39.5M26.6 41.7L25.7 43.3M26.6 40.9L25.5 39.5M29.2 41.3L28.5 42.9M29.0 40.4L27.7 39.2M31.6 40.8L31.0 42.4M31.4 39.9L30.1 38.7M34.0 39.9L33.6 41.6M33.7 39.1L32.2 38.1M36.3 38.8L36.1 40.6M35.9 38.0L34.4 37.2M38.6 37.7L38.5 39.4M38.1 36.9L36.5 36.2M40.8 36.6L40.6 38.3M40.4 35.7L38.9 34.9M42.9 35.2L42.7 37.0M42.5 34.4L41.0 33.6M45.1 33.9L45.0 35.7M44.6 33.1L43.0 32.4M47.2 32.6L47.1 34.4M46.8 31.8L45.2 31.1",
] as const;

function SeamStitches() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <clipPath id="badge-ball"><circle cx="24" cy="24" r="23.4" /></clipPath>
      </defs>
      <g clipPath="url(#badge-ball)" stroke="#c92a3c" fill="none" strokeLinecap="round" opacity={0.45}>
        {SEAM_PATHS.map((d, i) => <path key={i} d={d} strokeWidth={0.55} />)}
        {SEAM_STITCHES.map((d, i) => <path key={i} d={d} strokeWidth={0.9} />)}
      </g>
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  // The clicked tab lights up on press, before the route has changed. It is
  // tied to the path it was clicked FROM, so it lapses by itself once the route
  // moves (or the back button takes it somewhere else) with no effect to reset it.
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const target = pending && pending.from === pathname ? pending.href : null;
  // macOS drops a key's keyup while Command is still held, so a released key can look held: entries
  // expire after 3 s, and the whole set clears once no Command key is down.
  const meta = useRef(new Map<string, number>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "MetaLeft" || e.code === "MetaRight") meta.current.set(e.code, Date.now()); };
    const up = (e: KeyboardEvent) => { meta.current.delete(e.code); if (!e.metaKey) meta.current.clear(); };
    const clear = () => meta.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); };
  }, []);

  return (
    <nav className="glass-nav sticky top-0 z-50 relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6 lg:gap-x-4">
      {/* The lava field the header lives on, clipped in its own layer so the search results can hang below the bar */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><LavaNav /></div>
      {/* Pearl rail: the nav's bottom edge, painted before (under) everything else in the bar, so it never covers the page
          or the search results; scrolls with the sticky nav; a soft drop shadow lifts the header */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[4px]
        bg-[linear-gradient(180deg,#fffdf8_0%,#f5efe3_55%,#e9e1d1_100%)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_5px_-2px_rgba(15,23,42,0.25)]" />

      {/* Logo / Brand — a white shader badge sitting on top of the field:
          the base is a sphere gradient (white top-left into cool grey) so the
          specular spot reads; a faint reflection of the lava lands bottom-right;
          inner rim shading and a hairline ring finish it. */}
      <Link
        href="/"
        aria-label="GOAT-Pro home"
        onClick={(e) => {
          const now = Date.now();
          const both = e.metaKey && ["MetaLeft", "MetaRight"].every((k) => now - (meta.current.get(k) ?? 0) < 3000);
          if (!both) return;
          e.preventDefault();
          meta.current.clear();
          window.open("http://localhost:3000/admin", "_blank", "noopener,noreferrer");
        }}
        className="relative z-10 shrink-0 grid place-items-center w-12 h-12 rounded-full transition-transform duration-200 hover:scale-105 active:scale-95 ring-1 ring-slate-900/25
          bg-[linear-gradient(135deg,#ffffff_0%,#f7f9fb_45%,#e7ecf2_100%)]
          shadow-[0_4px_16px_rgba(2,6,12,0.55),0_1px_3px_rgba(2,6,12,0.4),inset_0_-6px_10px_rgba(96,108,128,0.42),inset_0_3px_6px_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(22,30,44,0.07)]"
      >
        <span aria-hidden className="absolute inset-0 rounded-full
          bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,1)_0%,rgba(255,255,255,0)_42%),radial-gradient(circle_at_72%_92%,rgba(96,190,205,0.5)_0%,rgba(96,190,205,0)_50%)]" />
        <SeamStitches />
        <span className="relative text-center leading-none">
          <span className="block text-[12px] font-extrabold tracking-tight text-[#131c2b]">GOAT</span>
          <span className="mt-[3px] block text-[8.5px] font-bold tracking-[0.22em] text-[#5c6b82]">-PRO</span>
        </span>
      </Link>

      {/* Nav Pills: one row. Spacing tightens with the window; whatever still
          doesn't fit fades out at the right and scrolls sideways (no bar). On a
          phone the strip takes its own row under the brand and search. */}
      <div className="nav-strip order-last flex w-full min-w-0 items-center gap-0.5 overflow-x-auto pr-6 sm:order-none sm:w-auto sm:flex-1 lg:ml-2 xl:ml-4 xl:gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/research"
            ? RESEARCH_SECTIONS.some((s) => pathname === s.href || pathname.startsWith(s.href + "/")) || pathname === "/research"
            : target
            ? target === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setPending({ href: item.href, from: pathname })}
              className={`
                relative z-10 shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-full text-[13px] font-semibold press-scale nav-glow lg:px-3 xl:text-sm 2xl:px-4
                [text-shadow:0_1px_2px_rgba(10,14,20,0.85)]
                ${
                  isActive
                    ? "bg-black/45 border border-white/25 text-white"
                    : "text-text-primary/85 hover:text-white hover:bg-black/25"
                }
              `}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Right side — search */}
      <div className="ml-auto flex shrink-0 items-center">
        <Search />
      </div>

    </nav>
  );
}
