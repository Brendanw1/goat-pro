"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "@/components/search";

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
  { href: "/arsenal", label: "Arsenal" },
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
    <nav className="glass-nav sticky top-0 z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      {/* Logo / Brand */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <Link
          href="/"
          className="text-lg font-bold tracking-wide text-text-primary"
        >
          GOAT-Pro
        </Link>

        {/* Nav Pills — wrap rather than run off the right edge. At 320px the
            pills wrap; none of them leaves the viewport. */}
        <div className="flex flex-wrap items-center gap-1">
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
                  px-4 py-1.5 rounded-full text-sm font-medium press-scale nav-glow
                  ${
                    isActive
                      ? "nav-pill-active text-text-primary"
                      : "text-text-secondary hover:text-text-primary hover:bg-white/[0.03]"
                  }
                `}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right side — search */}
      <div className="flex items-center gap-4">
        <Search />
      </div>
    </nav>
  );
}
