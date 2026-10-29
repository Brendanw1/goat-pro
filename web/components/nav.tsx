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

/* Baseball seams for the badge: the TRUE seam curve of a baseball — the
   figure-8 on a sphere (latitude = A\u00b7sin(2\u00b7longitude)) — rotated to the
   classic 3/4 pose and orthographically projected. Only the front strands
   render, so the arcs can never cross (two earlier hand-drawn bezier
   versions crossed; this one is generated from the real geometry). Paths
   and stitch ticks are precomputed literals — zero runtime cost — clipped
   to the ball and faded so the wordmark sits on top. */
const SEAM_PATHS = [
  "M37.7 35.5 L38.1 34.4 L38.4 33.2 L38.6 32.0 L38.7 30.8 L38.8 29.6 L38.7 28.3 L38.6 27.2 L38.5 26.0 L38.3 24.9 L38.0 23.9 L37.8 23.0 L37.6 22.1 L37.4 21.2 L37.3 20.4 L37.2 19.7 L37.1 19.0 L37.1 18.3 L37.1 17.7 L37.2 17.1 L37.3 16.4 L37.5 15.8 L37.6 15.2 L37.8 14.6 L38.0 14.0 L38.1 13.5 L38.2 12.9 L38.2 12.4 L38.2 11.9 L38.1 11.4 L37.9 11.1 L37.8 11.0",
  "M7.5 14.6 L7.3 15.2 L7.1 15.7 L7.1 16.3 L7.1 16.9 L7.1 17.5 L7.2 18.0 L7.2 18.6 L7.3 19.3 L7.4 19.9 L7.5 20.5 L7.5 21.2 L7.5 21.9 L7.5 22.6 L7.4 23.4 L7.4 24.3 L7.4 25.2 L7.4 26.2 L7.4 27.2 L7.5 28.4 L7.6 29.5 L7.8 30.7 L8.1 31.9 L8.5 33.1 L9.0 34.3 L9.6 35.5 L10.3 36.6 L11.1 37.6 L12.0 38.5 L12.9 39.4 L13.9 40.1 L14.2 40.3",
  "M33.8 40.3 L33.9 40.2 L34.1 40.1 L34.2 40.0 L34.4 39.9 L34.5 39.8 L34.7 39.6 L34.8 39.5 L35.0 39.4 L35.1 39.3 L35.2 39.1 L35.4 39.0 L35.5 38.9 L35.7 38.7 L35.8 38.6 L35.9 38.4 L36.1 38.2 L36.2 38.1 L36.3 37.9 L36.4 37.8 L36.6 37.6 L36.7 37.4 L36.8 37.2 L36.9 37.0 L37.0 36.8 L37.1 36.7 L37.2 36.5 L37.3 36.3 L37.4 36.1 L37.5 35.9 L37.6 35.7 L37.7 35.5",
] as const;

const SEAM_TICKS = [
  { x1: 37.0, y1: 30.9, x2: 40.4, y2: 31.2 },
  { x1: 36.1, y1: 23.0, x2: 39.4, y2: 22.2 },
  { x1: 35.5, y1: 16.8, x2: 38.9, y2: 17.3 },
  { x1: 36.5, y1: 12.5, x2: 39.9, y2: 12.7 },
  { x1: 8.8, y1: 16.7, x2: 5.4, y2: 16.8 },
  { x1: 9.2, y1: 21.4, x2: 5.8, y2: 21.4 },
  { x1: 9.1, y1: 28.1, x2: 5.8, y2: 28.4 },
  { x1: 12.0, y1: 36.0, x2: 9.3, y2: 38.1 },
  { x1: 33.5, y1: 38.4, x2: 35.6, y2: 41.1 },
  { x1: 34.7, y1: 37.3, x2: 37.3, y2: 39.4 },
  { x1: 35.7, y1: 35.7, x2: 38.7, y2: 37.3 },
] as const;

function SeamStitches() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="pointer-events-none absolute inset-0 h-full w-full opacity-60">
      <defs>
        <clipPath id="badge-ball"><circle cx="24" cy="24" r="19.5" /></clipPath>
      </defs>
      <g clipPath="url(#badge-ball)">
        {SEAM_PATHS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#c92a3c" strokeOpacity={0.8} strokeWidth={1.4} strokeLinejoin="round" />
        ))}
        {SEAM_TICKS.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke="#c92a3c" strokeWidth={1.6} strokeLinecap="round" />
        ))}
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
