"use client";

/**
 * Swing archetype + comps chip (RESULTS-MLB §94; bake pipeline/swing_archetypes.py). Lives in the Swing tab.
 * k-means on six z-scored swing traits (competitive swings, hitter-season). Stable across seasons, but the type
 * carries no next-season xwOBAcon information beyond bat speed: descriptive, neutral colour.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const COL = ["#e3b341", "#7da1c4", "#9bbf85", "#c48ab0"];

export function ArchetypeChip({ id, season }: { id: number | string; season: number | string }) {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/data/archetypes/${id}?season=${season}`).then((r) => (r.ok ? r.json() : null)).then((j) => live && setD(j)).catch(() => {});
    return () => { live = false; };
  }, [id, season]);
  if (!d?.row) return null;
  const { row: r, archetypes } = d;
  const a = archetypes[r.a];
  return (
    <figure className="glass-panel p-3">
      <figcaption className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-semibold text-text-primary">His swing shape:</span>
        <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: COL[r.a], color: COL[r.a] }}>{a.label}</span>
        <span className="text-[10px] text-text-dim">{season} · one of {archetypes.length} types · <Link href="/archetypes" className="underline">archetypes</Link> (§94)</span>
      </figcaption>
      <div className="text-[10px] uppercase tracking-wider text-text-dim">Closest swings (six traits, other hitters, 2024–26)</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {r.comps.map((c: any) => (
          <Link key={`${c.id}-${c.season}`} href={`/player/${c.id}?season=${c.season}&tab=swing`}
            className="rounded-md border border-white/[0.06] px-2 py-1 text-[11px] text-text-secondary hover:bg-white/[0.04]">
            {c.name ?? c.id} <span className="text-text-dim">{c.season} · {c.d.toFixed(1)}</span>
          </Link>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-text-dim leading-snug">
        Distance in SDs across bat speed, length, attack angle, attack direction, tilt and contact depth. The type is a stable
        description (same type next season {Math.round(100 * d.meta.stability.yoy.same)}% of the time) but adds nothing to next
        season&apos;s xwOBA on contact beyond bat speed. Descriptive, not a forecast.
      </p>
    </figure>
  );
}
