"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RESEARCH_SECTIONS } from "@/lib/research-sections";


export function ResearchToc() {
  const pathname = usePathname();
  return (
    <nav aria-label="Research sections" className="sticky top-0 z-10 -mx-1 mb-4 flex items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#05070b]/80 px-1 py-2 backdrop-blur">
      <Link href="/research" className="mr-2 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-dim hover:text-text-secondary">Research</Link>
      {RESEARCH_SECTIONS.map((s) => {
        const on = pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link key={s.href} href={s.href} aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${on ? "bg-white/10 text-white" : "text-text-secondary hover:bg-white/[0.05] hover:text-white"}`}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
