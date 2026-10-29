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
   fills the whole badge. Centerlines are Catmull-Rom fits of the traced
   points; paths are precomputed literals (zero runtime cost). */
const SEAM_PATHS = [
  "M2.8 7.9 L3.4 8.2 L3.8 8.4 L4.2 8.6 L4.5 8.7 L4.8 8.9 L5.2 9.0 L5.5 9.2 L5.9 9.4 L6.4 9.7 L7.0 10.0 L7.7 10.4 L8.4 10.8 L9.3 11.3 L10.2 11.9 L11.1 12.5 L12.0 13.0 L13.0 13.6 L13.9 14.0 L14.8 14.5 L15.7 14.8 L16.6 15.1 L17.4 15.3 L18.2 15.5 L19.1 15.6 L19.9 15.8 L20.7 15.8 L21.5 15.9 L22.3 15.9 L23.2 15.8 L24.0 15.7 L24.8 15.6 L25.7 15.4 L26.6 15.1 L27.4 14.8 L28.3 14.5 L29.2 14.1 L30.0 13.7 L30.9 13.3 L31.7 12.9 L32.5 12.5 L33.3 12.1 L34.1 11.6 L34.9 11.1 L35.7 10.5 L36.5 10.0 L37.3 9.4 L38.0 8.9 L38.7 8.4 L39.3 7.9 L39.9 7.4 L40.4 7.1 L40.8 6.7 L41.1 6.4 L41.5 6.1 L41.8 5.8 L42.0 5.6 L42.3 5.3 L42.6 5.0 L42.9 4.6 L43.3 4.2 L43.3 4.2",
  "M2.8 40.6 L3.4 40.3 L3.8 40.0 L4.2 39.8 L4.5 39.6 L4.8 39.4 L5.2 39.2 L5.5 39.0 L5.9 38.8 L6.4 38.5 L7.0 38.3 L7.7 37.9 L8.4 37.6 L9.3 37.2 L10.2 36.8 L11.1 36.3 L12.0 35.9 L13.0 35.5 L13.9 35.2 L14.8 34.8 L15.7 34.6 L16.6 34.4 L17.4 34.2 L18.2 34.0 L19.1 33.9 L19.9 33.8 L20.7 33.7 L21.5 33.7 L22.4 33.7 L23.2 33.6 L24.0 33.7 L24.8 33.7 L25.7 33.8 L26.5 33.8 L27.3 33.9 L28.2 34.1 L29.0 34.2 L29.8 34.4 L30.7 34.6 L31.5 34.8 L32.3 35.0 L33.1 35.3 L33.9 35.6 L34.8 36.0 L35.6 36.4 L36.4 36.8 L37.2 37.2 L38.0 37.6 L38.7 38.0 L39.5 38.4 L40.1 38.7 L40.7 39.0 L41.2 39.3 L41.6 39.6 L42.1 39.8 L42.5 40.1 L42.8 40.4 L43.3 40.6 L43.7 40.9 L44.2 41.2 L44.7 41.5 L44.7 41.5",
] as const;

const SEAM_STITCHES = [
  "M4.7 9.4L4.8 11.5M5.2 8.4L6.9 7.2M6.7 10.5L6.7 12.6M7.2 9.5L9.0 8.3M8.8 11.7L8.7 13.8M9.4 10.7L11.2 9.7M10.8 12.9L10.7 15.0M11.4 12.0L13.2 10.9M13.0 14.2L13.0 16.3M13.5 13.2L15.2 12.0M15.3 15.2L15.6 17.3M15.7 14.2L17.3 12.8M17.7 15.9L18.2 18.0M17.9 14.9L19.3 13.3M20.2 16.4L21.0 18.3M20.3 15.3L21.5 13.5M22.8 16.4L23.9 18.2M22.7 15.3L23.6 13.4M25.2 16.1L26.5 17.7M24.9 15.0L25.5 13.0M27.6 15.3L29.2 16.7M27.3 14.3L27.6 12.2M29.8 14.4L31.5 15.7M29.4 13.4L29.5 11.3M32.0 13.4L33.7 14.6M31.5 12.4L31.5 10.3M34.2 12.2L36.0 13.2M33.6 11.2L33.5 9.1M36.2 10.8L38.1 11.8M35.6 9.9L35.4 7.8M38.1 9.5L40.0 10.3M37.5 8.6L37.2 6.5M40.1 8.0L42.0 8.8M39.4 7.1L39.1 5.0M41.9 6.4L43.9 7.1M41.2 5.6L40.6 3.6M43.6 4.7L45.6 5.3M42.8 3.9L42.2 1.9",
  "M5.1 39.9L7.0 40.9M4.5 38.9L4.4 36.8M7.2 38.8L8.9 40.0M6.7 37.8L6.9 35.7M9.3 37.8L11.0 39.0M8.8 36.8L8.9 34.7M11.6 36.7L13.2 38.0M11.1 35.7L11.3 33.6M13.7 35.9L15.3 37.2M13.3 34.8L13.5 32.7M15.9 35.1L17.3 36.6M15.6 34.1L16.0 32.0M18.1 34.6L19.4 36.2M17.9 33.5L18.6 31.5M20.6 34.3L21.7 36.1M20.5 33.2L21.3 31.3M23.0 34.2L24.0 36.0M23.0 33.1L24.0 31.2M25.4 34.3L26.3 36.2M25.5 33.2L26.6 31.4M27.7 34.5L28.4 36.5M27.8 33.5L29.1 31.8M29.9 35.0L30.5 37.0M30.2 33.9L31.5 32.3M32.1 35.6L32.5 37.6M32.4 34.5L33.9 33.0M34.3 36.4L34.5 38.5M34.8 35.4L36.4 34.1M36.6 37.5L36.6 39.6M37.1 36.5L38.8 35.3M38.7 38.6L38.7 40.7M39.2 37.6L40.9 36.5M40.8 39.7L40.8 41.8M41.3 38.8L43.1 37.7M42.8 40.9L42.6 43.0M43.3 40.0L45.2 39.0",
] as const;

function SeamStitches() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <clipPath id="badge-ball"><circle cx="24" cy="24" r="23.4" /></clipPath>
      </defs>
      <g clipPath="url(#badge-ball)" stroke="#c92a3c" fill="none" strokeLinecap="round" opacity={0.85}>
        {SEAM_PATHS.map((d, i) => <path key={i} d={d} strokeWidth={0.6} strokeOpacity={0.55} />)}
        {SEAM_STITCHES.map((d, i) => <path key={i} d={d} strokeWidth={1.1} />)}
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
