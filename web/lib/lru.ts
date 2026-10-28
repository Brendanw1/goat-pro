/**
 * Get-or-make on a Map used as an LRU: a hit is re-inserted so it becomes the
 * newest, a miss is made and inserted, and past `max` the oldest key goes.
 * Map iteration is insertion order, so "oldest" is just the first key.
 */
export function lruGet<V>(cache: Map<string, V>, key: string, max: number, make: () => V): V {
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const v = make();
  cache.set(key, v);
  while (cache.size > max) cache.delete(cache.keys().next().value!);
  return v;
}
