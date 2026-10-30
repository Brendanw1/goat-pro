"use client";

/**
 * Filter-faithful back links (owner ask 2026-10-29): "← Back" must return to the
 * last page with the same filters. The boards keep every filter in the URL
 * (?view=&season=&team=&sort=&dir=&page=), so a small session route stack is the
 * whole trick: RouteTracker (mounted once in the dashboard layout) records each
 * pathname+search, and BackLink renders the entry below the current one. The
 * fallback is the old hardcoded href — what SSR shows and what a fresh tab or a
 * deep link gets. The stack is client state on purpose: server components can't
 * know how the reader got here, and sessionStorage survives a refresh, which is
 * exactly when the hardcoded fallback used to bite.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const KEY = "gp:routeStack";
const CAP = 30;

function readStack(): string[] {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(s) ? s.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function RouteTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const here = pathname + (search ? `?${search}` : "");
    const stack = readStack();
    if (stack[stack.length - 1] === here) return; // refresh or a re-render: keep the previous entry
    stack.push(here);
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-CAP)));
  }, [pathname, search]);
  return null;
}

export function BackLink({ fallback, label = "← Back", className }: {
  fallback: string;
  label?: string;
  className?: string;
}) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const stack = readStack();
    const here = location.pathname + location.search;
    // the entry below the current one; tolerate the stack not knowing this page yet
    const at = stack.lastIndexOf(here);
    const prev = at > 0 ? stack[at - 1] : stack.length >= 2 && at === -1 ? stack[stack.length - 1] : null;
    setHref(prev && prev !== here ? prev : null);
  }, []);
  return (
    <Link href={href ?? fallback} className={className}>
      {label}
    </Link>
  );
}
