"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "@/components/search";
import { LavaPill } from "@/components/ui/lava-bar";

const NAV_ITEMS = [
  { href: "/pitchers", label: "Pitchers" },
  { href: "/hitters", label: "Hitters" },
  { href: "/minors", label: "Minors" },
  { href: "/prospects", label: "Prospects" },
  { href: "/teams", label: "Teams" },
  { href: "/tunneling", label: "Tunneling" },
  { href: "/fatigue", label: "Fatigue" },
  { href: "/abs", label: "ABS" },
  { href: "/wpa", label: "WPA" },
  { href: "/aging", label: "Aging" },
  { href: "/framing", label: "Framing" },
  { href: "/arsenal", label: "Arsenal" },
  { href: "/buckets", label: "Buckets" },
  { href: "/scouting/savant", label: "Savant boards" },
  { href: "/glossary", label: "Glossary" },
] as const;

export function Nav() {
  const pathname = usePathname();
  // The clicked tab lights up on press, before the route has changed. It is
  // tied to the path it was clicked FROM, so it lapses by itself once the route
  // moves (or the back button takes it somewhere else) with no effect to reset it.
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const target = pending && pending.from === pathname ? pending.href : null;

  return (
    <nav className="glass-nav sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6 lg:gap-x-4">
      {/* Logo / Brand */}
      <Link
        href="/"
        className="shrink-0 text-lg font-bold tracking-wide text-text-primary"
      >
        GOAT-Pro
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
                shrink-0 whitespace-nowrap px-2 py-1.5 rounded-full text-[13px] font-medium press-scale nav-glow lg:px-2.5 xl:px-3 xl:text-sm 2xl:px-4
                ${
                  isActive
                    ? "relative text-white overflow-hidden"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.03]"
                }
              `}
            >
              {isActive && <LavaPill />}
              <span className="relative">{item.label}</span>
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
