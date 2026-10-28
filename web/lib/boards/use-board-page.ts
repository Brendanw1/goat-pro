"use client";

/**
 * The client half of a paged board: fetch the current view from its
 * /api/data/board route, keyed on the canonical query string (toParams), so a
 * view already seen comes back from cache. The server page hands over the
 * default view as `initial`, so first paint makes no request at all.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toParams, type BoardPage, type BoardState } from "./shared";

/** Long enough that a typed name is one request, short enough not to read as lag. */
export const SEARCH_DEBOUNCE_MS = 250;

export function useBoardPage<P extends BoardPage<unknown>>(endpoint: string, state: BoardState, defaults: BoardState, initial: P) {
  const [search, setSearch] = useState(state.search);
  useEffect(() => {
    const t = setTimeout(() => setSearch(state.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state.search]);

  const qs = toParams({ ...state, search }, defaults);
  const q = useQuery({
    queryKey: ["board", endpoint, qs],
    queryFn: async ({ signal }) => {
      const r = await fetch(qs ? `${endpoint}?${qs}` : endpoint, { signal });
      if (!r.ok) throw new Error(`${endpoint}: ${r.status}`);
      return (await r.json()) as P;
    },
    initialData: qs === "" ? initial : undefined,
    // The previous page stays on screen (dimmed) while the next one loads; a
    // board that blanks on every keystroke is worse than one a beat behind.
    placeholderData: keepPreviousData,
    // The export changes at most daily; lib/r2.ts holds the parsed file 5 min.
    staleTime: 5 * 60_000,
  });
  return { data: q.data, fetching: q.isFetching, error: q.isError };
}
