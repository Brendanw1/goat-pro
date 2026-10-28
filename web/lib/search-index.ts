export interface SearchEntry {
  id: string;
  name: string;
  team: string;
  type: "pitcher" | "hitter";
  position?: string;
  /** Lowercased name for fast matching */
  nameLC: string;
}

export interface SearchIndex {
  entries: SearchEntry[];
}

/**
 * Builds a searchable index from hitters and pitchers arrays.
 * Call once when data loads; pass the index to the Search component.
 */
export function buildSearchIndex(
  hitters: { id: string; name: string; team: string; position?: string }[],
  pitchers: { id: string; name: string; team: string; position?: string }[]
): SearchIndex {
  const entries: SearchEntry[] = [];

  for (const h of hitters) {
    entries.push({
      id: h.id,
      name: h.name,
      team: h.team,
      type: "hitter",
      position: h.position,
      nameLC: h.name.toLowerCase(),
    });
  }

  for (const p of pitchers) {
    entries.push({
      id: p.id,
      name: p.name,
      team: p.team,
      type: "pitcher",
      position: p.position,
      nameLC: p.name.toLowerCase(),
    });
  }

  return { entries };
}

/**
 * Searches the index for entries matching the query.
 * Uses substring matching with prefix boost.
 */
export function searchIndex(
  index: SearchIndex,
  query: string,
  maxResults = 8
): SearchEntry[] {
  if (!query || query.length < 1) return [];

  const q = query.toLowerCase().trim();
  if (q.length === 0) return [];

  const results: { entry: SearchEntry; score: number }[] = [];

  for (const entry of index.entries) {
    // Exact start match (highest priority)
    if (entry.nameLC.startsWith(q)) {
      results.push({ entry, score: 3 });
    }
    // Word start match
    else if (entry.nameLC.split(" ").some((word) => word.startsWith(q))) {
      results.push({ entry, score: 2 });
    }
    // Substring match
    else if (entry.nameLC.includes(q)) {
      results.push({ entry, score: 1 });
    }
  }

  // Sort by score descending, then alphabetically
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.name.localeCompare(b.entry.name);
  });

  return results.slice(0, maxResults).map((r) => r.entry);
}
