# Page caching: what is done, what is queued

Why: AI crawlers on dynamic pages drove the Vercel bill (95% per-request renders, 97% cache MISS, 470-890 KB HTML
each). Data changes only when we bake and sync, about once a day, so pages can be served from the ISR cache.

## The recipe (shipped 2026-10-30)

`web/proxy.ts` rewrites every request for a converted path, with or without a query, to `<path>/q/<key>`.
`<key>` is the page's whitelisted query, sorted and base64url-encoded (`web/lib/query-key.ts`; `_` = the default
view). The q route is ISR (`revalidate = 86400`, `generateStaticParams`), so each distinct view renders once a
day and the browser URL, deep links and every link-driven control stay exactly as they were. The page body moved
unchanged to `view.tsx` beside it. The bare path has to be rewritten as well: a static bare page next to rewritten
query views made the client router reuse the bare page's prefetch for every query link.

To convert a page: move `page.tsx` to `view.tsx` and delete `export const dynamic`, add `q/[key]/page.tsx` (copy
`prospects/q/[key]/page.tsx`), then add the path to `QUERY_ROUTES` and to the `matcher` in `proxy.ts`.

Freshness: pages refresh at most a day after a bake. If that is too slow, add a protected revalidate route
for `r2_sync` to call (`revalidatePath`, with a secret kept in env). Not built yet.

Converted: `/prospects`, `/teams/[abbr]` (30 clubs prebuilt), `/minors`, `/minors/player/[id]`, `/games/[gid]`
(on-demand ISR, nothing prebuilt).

## Queue, by traffic (production request log, 2026-10-30, 40 min, 10k requests)

| # | Route | Hits | Blocker |
|---|-------|-----:|---------|
| 1 | `/player/[id]` | 1,943 | `force-dynamic` + `searchParams` (season, level, tab). Movement-plot, "where he swings" and catcher-defense agents have uncommitted edits in `player/[id]/*`; convert after they land. Also `/player/[id]/sheet`. |
| 2 | `/` (home) | 117 | `force-dynamic` + `searchParams` (season, role). Recipe applies as is. |
| 3 | `/defense` | 104 | `force-dynamic` + `searchParams`; uncommitted edits from the catcher-defense agent. |
| 4 | `/matchup` | 54 | `force-dynamic` + `searchParams`; uncommitted edits. Matchup pairs are numerous: whitelist the keys tightly. |
| 5 | `/hitters` | 44 | `searchParams` (view, season, team, sort, dir, page). Recipe applies. |
| 6 | `/arsenal` | 33 | `searchParams`. Recipe applies. |
| 7 | `/postseason` | 28 | `force-dynamic` + `searchParams`. |
| 8 | `/arsenal/[pitch]` | 27 | No dynamic API: it only lacks `revalidate` + `generateStaticParams` (one per pitch code). The easiest one. |
| 9 | `/wpa` | 25 | `force-dynamic` + `searchParams`. |
| 10 | `/teams` | 24 | `force-dynamic` only (comment says it avoids R2 at build; Vercel builds have the R2 env now). Add `revalidate`. |
| 11 | `/trades` | 24 | `force-dynamic` + `searchParams`. |
| 12 | `/rosters` | 15 | `force-dynamic` + `searchParams`. |
| 13+ | `/buckets`, `/abs`, `/reports/projections`, `/dong`, `/roles`, `/archetypes`, `/framing`, `/scouting/savant`, `/tunneling`, `/aging`, `/depth`, `/fatigue`, `/mechanism`, `/plane`, `/games/[gid]/report` | ≤13 each | `force-dynamic` + `searchParams`; low traffic. |

API routes (`/api/data/*`) already send `s-maxage` headers and are not counted here.

Payload, not addressed here: even a 404 page is ~280 KB of HTML, so the shared layout (nav, flight data) is most
of every page. Worth measuring separately.
