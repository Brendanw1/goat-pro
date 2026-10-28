"use client";

import { useEffect, useState } from "react";
import { lruGet } from "@/lib/lru";

/**
 * One Stuff+ v8 artifact from /api/data/stuff-model/<key>, parsed and cached for the tab.
 *
 * Promises are cached, not results, so two components mounting at once share one request; a failed fetch is dropped
 * from the cache so it can be retried. Capped at 12 keys, least recently used out: a parsed booster is a few MB of
 * arrays, and a coach flipping types and sides needs at most a full and a what-if booster per class x side.
 */
const cache = new Map<string, Promise<unknown>>();

function load<T>(key: string, parse: (raw: unknown) => T): Promise<T> {
  return lruGet(cache, key, 12, () => {
    const pending = fetch(`/api/data/stuff-model/${key}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Stuff+ artifact ${key} unavailable (${r.status})`);
        return r.json();
      })
      .then(parse);
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
    return pending;
  }) as Promise<T>;
}

export interface ArtifactState<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load `key` (null: nothing to load). Keyed like use-3d-records: the result carries the key it belongs to, so a key
 * change reads as loading rather than briefly showing the previous artifact. `parse` must be a stable function.
 */
export function useStuffArtifact<T>(key: string | null, parse: (raw: unknown) => T): ArtifactState<T> {
  const [loaded, setLoaded] = useState<{ key: string; value: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    load(key, parse)
      .then((value) => { if (active) setLoaded({ key, value, error: null }); })
      .catch((e: unknown) => {
        if (active) setLoaded({ key, value: null, error: e instanceof Error ? e.message : "Model load failed" });
      });
    return () => { active = false; };
  }, [key, parse]);

  if (key === null) return { value: null, loading: false, error: null };
  const current = loaded?.key === key ? loaded : null;
  return { value: current?.value ?? null, loading: current === null, error: current?.error ?? null };
}
