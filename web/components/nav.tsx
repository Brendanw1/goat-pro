"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "@/components/search";
import { LavaNav } from "@/components/ui/lava-bar";

const NAV_ITEMS = [
  { href: "/pitchers", label: "Pitchers" },
  { href: "/hitters", label: "Hitters" },
  { href: "/minors", label: "Minors" },
  { href: "/prospects", label: "Prospects" },
  { href: "/trades", label: "Trades" },
  { href: "/teams", label: "Teams" },
  { href: "/tunneling", label: "Tunneling" },
  { href: "/fatigue", label: "Fatigue" },
  { href: "/abs", label: "ABS" },
  { href: "/wpa", label: "WPA" },
  { href: "/aging", label: "Aging" },
  { href: "/framing", label: "Framing" },
  { href: "/defense", label: "Defense" },
  { href: "/arsenal", label: "Arsenal" },
  { href: "/buckets", label: "Buckets" },
  { href: "/scouting/savant", label: "Savant boards" },
  { href: "/glossary", label: "Glossary" },
] as const;

/* Baseball seams for the badge, traced from the owner's reference (pngtree
   "3D baseball on transparent background"): the front-on view, one seam
   smiling across the upper face and one frowning across the lower face,
   both running off the rim, with V-stitches straddling each seam. The ball
   fills the whole badge. Owner revision: each seam is mirrored within its own
   band so it bows out toward the rim (clear of the wordmark), the stitches are
   diagonal V pairs every 2.5 units with the seam line down their middle, and
   the whole set is faded so GOAT / PRO read first. Precomputed literals. */
const SEAM_PATHS = [
  "M2.8 12.2 L3.6 11.8 L4.5 11.4 L5.3 11.0 L6.1 10.6 L6.9 10.1 L7.7 9.7 L8.5 9.2 L9.3 8.8 L10.1 8.3 L10.9 7.8 L11.7 7.3 L12.5 6.8 L13.3 6.4 L14.1 6.0 L14.9 5.6 L15.8 5.3 L16.7 5.0 L17.6 4.8 L18.5 4.6 L19.4 4.4 L20.3 4.3 L21.2 4.2 L22.1 4.2 L23.1 4.3 L24.0 4.4 L24.9 4.5 L25.8 4.7 L26.7 5.0 L27.5 5.3 L28.4 5.6 L29.2 6.0 L30.1 6.4 L30.9 6.8 L31.7 7.2 L32.6 7.6 L33.4 8.1 L34.2 8.5 L35.0 9.0 L35.7 9.6 L36.5 10.1 L37.2 10.6 L38.0 11.2 L38.7 11.7 L39.4 12.3 L40.2 12.9 L40.9 13.5 L41.6 14.1 L42.2 14.7 L42.8 15.4",
  "M2.8 34.5 L3.6 34.9 L4.4 35.4 L5.1 35.9 L5.9 36.3 L6.7 36.7 L7.6 37.1 L8.4 37.5 L9.2 37.9 L10.0 38.2 L10.8 38.7 L11.7 39.1 L12.5 39.4 L13.4 39.7 L14.2 40.0 L15.0 40.4 L15.9 40.6 L16.8 40.8 L17.7 41.0 L18.6 41.1 L19.5 41.2 L20.4 41.4 L21.3 41.4 L22.2 41.4 L23.1 41.5 L24.0 41.4 L24.9 41.4 L25.8 41.3 L26.7 41.3 L27.6 41.1 L28.5 41.0 L29.4 40.8 L30.3 40.6 L31.2 40.4 L32.1 40.2 L32.9 39.9 L33.8 39.5 L34.6 39.2 L35.4 38.8 L36.2 38.4 L37.0 38.0 L37.9 37.6 L38.7 37.1 L39.5 36.7 L40.3 36.3 L41.1 35.9 L41.8 35.4 L42.6 34.9 L43.4 34.5 L44.1 34.0",
] as const;

const SEAM_STITCHES = [
  "M4.2 12.0L4.0 13.7M3.8 11.2L2.3 10.3M6.5 10.9L6.4 12.6M6.1 10.1L4.5 9.3M8.5 9.7L8.4 11.5M8.1 9.0L6.5 8.2M10.7 8.4L10.7 10.1M10.2 7.6L8.6 7.0M12.9 7.1L12.8 8.8M12.4 6.3L10.8 5.6M15.1 6.0L14.7 7.7M14.8 5.1L13.3 4.1M17.5 5.3L16.8 6.9M17.2 4.4L15.9 3.2M19.7 4.8L19.1 6.5M19.5 3.9L18.2 2.8M22.1 4.6L21.1 6.1M22.1 3.8L21.2 2.3M24.6 4.9L23.4 6.2M24.7 4.0L23.9 2.5M26.9 5.6L25.5 6.6M27.3 4.8L26.8 3.1M29.2 6.5L27.7 7.4M29.7 5.7L29.4 4.0M31.5 7.6L30.0 8.5M31.9 6.8L31.7 5.1M33.5 8.7L31.9 9.4M34.0 7.9L33.9 6.2M35.6 10.1L34.0 10.8M36.1 9.3L36.0 7.6M37.7 11.5L36.0 12.1M38.2 10.8L38.3 9.0M39.7 13.1L38.1 13.8M40.2 12.4L40.2 10.6M41.6 14.7L39.8 15.0M42.2 14.1L42.5 12.3",
  "M3.8 35.6L2.2 36.4M4.2 34.8L4.0 33.0M5.9 36.8L4.3 37.6M6.4 36.1L6.2 34.3M8.2 37.9L6.7 38.8M8.6 37.1L8.2 35.4M10.4 38.9L8.8 39.7M10.9 38.2L10.7 36.4M12.8 40.0L11.3 41.0M13.1 39.1L12.7 37.4M15.2 40.8L13.9 42.0M15.4 40.0L14.7 38.3M17.6 41.4L16.3 42.6M17.8 40.5L17.2 38.9M20.1 41.8L18.9 43.1M20.2 40.9L19.4 39.3M22.6 41.9L21.4 43.2M22.7 41.0L21.9 39.4M25.2 41.8L24.4 43.4M25.1 40.9L23.9 39.6M27.7 41.6L27.1 43.2M27.5 40.7L26.2 39.5M30.2 41.1L29.5 42.7M30.0 40.2L28.7 39.0M32.7 40.4L32.2 42.2M32.3 39.6L30.9 38.6M35.0 39.5L34.7 41.2M34.6 38.7L33.1 37.8M37.2 38.4L37.0 40.1M36.8 37.6L35.3 36.7M39.5 37.2L39.2 39.0M39.1 36.4L37.5 35.6M41.7 36.0L41.7 37.7M41.2 35.3L39.5 34.7M43.8 34.7L43.9 36.4M43.3 34.0L41.6 33.4",
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

  return (
    <nav className="glass-nav sticky top-0 z-50 relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6 lg:gap-x-4">
      {/* The lava field the header lives on, clipped in its own layer so the search results can hang below the bar */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><LavaNav /></div>

      {/* Logo / Brand — a white shader badge sitting on top of the field:
          the base is a sphere gradient (white top-left into cool grey) so the
          specular spot reads; a faint reflection of the lava lands bottom-right;
          inner rim shading and a hairline ring finish it. */}
      <Link
        href="/"
        aria-label="GOAT-Pro home"
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
          const isActive = target
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
