/**
 * Query-string pages served from the ISR cache (perf 2026-10-30). Reading `searchParams` on the server makes a
 * page render on every request, and crawlers made those renders most of the Vercel bill. `proxy.ts` instead
 * rewrites every request for these paths, `/prospects` and `/prospects?year=2025` alike, to `/prospects/q/<key>`,
 * an ISR route, so each distinct view renders once per revalidate window and the browser URL never changes.
 * The bare path rewrites too (key "_"): a plain static `/prospects` next to rewritten query views made the client
 * router reuse the plain page's prefetch for every query link. The key is the whitelisted, sorted query,
 * base64url-encoded: unknown params (utm, _rsc) and odd values drop out, which bounds the cache.
 */

/** Path pattern → the query keys that page reads. Order matters only for readability. */
export const QUERY_ROUTES: [RegExp, string[]][] = [
  [/^\/prospects$/, ["year", "view", "team", "pos", "riser", "fy", "fsort", "forder"]],
  [/^\/teams\/[A-Za-z0-9]{1,5}$/, ["season", "psort", "hsort", "pdir", "hdir"]],
  [/^\/minors$/, ["kind", "season", "level", "min", "sort", "dir", "page", "src", "team", "age"]],
  [/^\/minors\/player\/\d+$/, ["season"]],
  [/^\/games\/\d+$/, ["level"]],
];

const VALUE = /^[A-Za-z0-9_.-]{1,24}$/;

/** The cache key for a request: "_" when no whitelisted param is set (the default view). */
export function encodeQueryKey(params: URLSearchParams, keys: string[]): string {
  const kept = keys.filter((k) => VALUE.test(params.get(k) ?? "")).sort().map((k) => [k, params.get(k)!]);
  if (!kept.length) return "_";
  return btoa(new URLSearchParams(kept).toString()).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The query object a page would have read from searchParams; null for a key that does not decode. */
export function decodeQueryKey(key: string): Record<string, string> | null {
  if (key === "_") return {};
  try {
    const p = new URLSearchParams(atob(key.replace(/-/g, "+").replace(/_/g, "/")));
    const out: Record<string, string> = {};
    for (const [k, v] of p) if (VALUE.test(v)) out[k] = v;
    return out;
  } catch {
    return null;
  }
}
