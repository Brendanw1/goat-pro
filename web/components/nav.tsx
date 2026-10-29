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

/* Baseball seams for the badge: two bold vertical arcs bowing out to the
   edges — the curve itself is the visible seam — each carried by a red line
   and stitched ticks laid perpendicular to it. Computed once at import;
   rendered as static SVG (no JS at runtime) and faded so the wordmark sits
   on top of it. */
const SEAM_CURVES = [
  { d: "M13.5 5 C6 15 6 33 13.5 43", p0: [13.5, 5], p1: [6, 15], p2: [6, 33], p3: [13.5, 43] },
  { d: "M34.5 5 C42 15 42 33 34.5 43", p0: [34.5, 5], p1: [42, 15], p2: [42, 33], p3: [34.5, 43] },
];
const SEAM_TICKS: Array<{ x1: number; y1: number; x2: number; y2: number }> = (() => {
  const ticks = [];
  for (const c of SEAM_CURVES) {
    for (let i = 0; i <= 11; i++) {
      const t = i / 11;
      const mt = 1 - t;
      const x = mt * mt * mt * c.p0[0] + 3 * mt * mt * t * c.p1[0] + 3 * mt * t * t * c.p2[0] + t * t * t * c.p3[0];
      const y = mt * mt * mt * c.p0[1] + 3 * mt * mt * t * c.p1[1] + 3 * mt * t * t * c.p2[1] + t * t * t * c.p3[1];
      const dx = 3 * mt * mt * (c.p1[0] - c.p0[0]) + 6 * mt * t * (c.p2[0] - c.p1[0]) + 3 * t * t * (c.p3[0] - c.p2[0]);
      const dy = 3 * mt * mt * (c.p1[1] - c.p0[1]) + 6 * mt * t * (c.p2[1] - c.p1[1]) + 3 * t * t * (c.p3[1] - c.p2[1]);
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const half = 1.7;
      ticks.push({ x1: x - nx * half, y1: y - ny * half, x2: x + nx * half, y2: y + ny * half });
    }
  }
  return ticks;
})();

function SeamStitches() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="pointer-events-none absolute inset-0 h-full w-full opacity-60">
      {SEAM_CURVES.map((c) => (
        <path key={c.d} d={c.d} fill="none" stroke="#c92a3c" strokeOpacity={0.8} strokeWidth={1.4} />
      ))}
      {SEAM_TICKS.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke="#c92a3c" strokeWidth={1.6} strokeLinecap="round" />
      ))}
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
    <nav className="glass-nav sticky top-0 z-50 relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6 lg:gap-x-4 overflow-hidden">
      {/* The lava field the header lives on */}
      <LavaNav />

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
