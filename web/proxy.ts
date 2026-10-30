import { NextResponse, type NextRequest } from "next/server";
import { QUERY_ROUTES, encodeQueryKey } from "@/lib/query-key";

/** Every view of these pages → its ISR twin under `<path>/q/<key>` (see lib/query-key.ts). The browser URL stays put;
 *  the query rides along untouched (Next needs its _rsc) and the q page never reads it. */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const keys = QUERY_ROUTES.find(([re]) => re.test(pathname))?.[1];
  if (!keys) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = `${pathname}/q/${encodeQueryKey(searchParams, keys)}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/prospects", "/teams/:abbr", "/minors", "/minors/player/:id", "/games/:gid"],
};
