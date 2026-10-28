"use client";

/**
 * A board's panel filters in the URL (?team=NYY&minPA=50), so Back from a profile restores them and a view can be
 * shared. Only values that differ from the defaults are written; each value is parsed back by its default's type.
 * Read on mount behind a timer and written with replaceState, as useUrlFilters (components/ui/filter-builder.tsx) does.
 */
import { useEffect, useState } from "react";

type Val = string | number | boolean;

export function useUrlRecord<T extends Record<string, Val>>(defaults: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaults);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      const out: Record<string, Val> = { ...defaults };
      for (const [k, d] of Object.entries(defaults)) {
        const v = q.get(k);
        if (v === null) continue;
        if (typeof d === "number") { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
        else if (typeof d === "boolean") out[k] = v === "1";
        else out[k] = v;
      }
      setValue(out as T);
    }, 0);
    return () => clearTimeout(t);
    // defaults are a constant per board; reading once on mount is the point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const update = (next: T) => {
    setValue(next);
    const url = new URL(window.location.href);
    for (const [k, d] of Object.entries(defaults)) {
      const v = next[k];
      if (v === d || v === undefined || v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return [value, update];
}
