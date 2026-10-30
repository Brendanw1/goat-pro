"use client";

import { useState } from "react";
import Link from "next/link";
import { PITCH_CONFIG } from "@/lib/constants";
import type { ArsenalCardData, PitchType } from "@/types";
import { GyroTag } from "@/components/ui/shared-grade-note";
import { sortComparator } from "@/lib/table-sort";

const INITIAL_ROWS = 5;
const EXPANDED_ROWS = 10;

type SortKey = "primaryMetric" | "name";

export function ArsenalGrid({ cards }: { cards: ArsenalCardData[] }) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [cardSort, setCardSort] = useState<Record<string, SortKey>>({});
  const [cardAsc, setCardAsc] = useState<Record<string, boolean>>({});

  function toggleExpand(pitchType: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(pitchType)) {
        next.delete(pitchType);
      } else {
        next.add(pitchType);
      }
      return next;
    });
  }

  function toggleSort(pitchType: string) {
    // whiff desc -> whiff asc -> name A-Z -> whiff desc
    const onName = cardSort[pitchType] === "name";
    const asc = !!cardAsc[pitchType];
    setCardSort((prev) => ({ ...prev, [pitchType]: onName || asc ? (onName ? "primaryMetric" : "name") : "primaryMetric" }));
    setCardAsc((prev) => ({ ...prev, [pitchType]: !onName && !asc }));
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card) => {
        const config = PITCH_CONFIG[card.pitchType as PitchType];
        if (!config) return null;

        const isExpanded = expandedCards.has(card.pitchType);
        const rowsToShow = isExpanded ? EXPANDED_ROWS : INITIAL_ROWS;
        const sortKey = cardSort[card.pitchType] || "primaryMetric";

        // Sort pitchers within card
        const asc = !!cardAsc[card.pitchType];
        const sorted = [...card.topPitchers].sort(
          sortComparator(sortKey, sortKey === "name" || asc ? "asc" : "desc"),
        );
        const visiblePitchers = sorted.slice(0, rowsToShow);

        return (
          <div
            key={card.pitchType}
            className={`glass-panel overflow-hidden transition-all duration-300 ${
              isExpanded ? "shadow-[0_12px_48px_rgba(0,0,0,0.4)]" : ""
            }`}
          >
            {/* Card Header — clickable stats for sorting */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
                <h2 className="text-sm font-semibold text-text-primary">
                  {config.label}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <button
                  onClick={() => toggleSort(card.pitchType)}
                  className={`transition-colors ${
                    sortKey === "primaryMetric"
                      ? "text-usf-gold font-medium"
                      : "text-text-dim hover:text-text-secondary"
                  }`}
                  title="Sort by Whiff%"
                >
                  {card.avgWhiff.toFixed(1)}% whiff{sortKey === "name" ? " · A-Z" : asc ? " ▲" : " ▼"}
                </button>
                <span className="text-text-dim">{card.avgVelo.toFixed(1)} mph</span>
                {"season" in card && card.season ? <span className="text-text-dim">· {String(card.season)}</span> : null}
              </div>
            </div>

            {/* Pitcher Rows with smooth height transition */}
            <div
              className="px-4 py-2 transition-all duration-300 ease-in-out overflow-hidden"
              style={{ maxHeight: isExpanded ? "440px" : "220px" }}
            >
              {visiblePitchers.map((pitcher, i) => (
                // The row used to navigate on click from a plain div, so this
                // list of pitchers was mouse-only. The name is a link now.
                <div
                  key={pitcher.id}
                  className={`flex items-center justify-between py-1.5 hover:bg-white/[0.04] -mx-2 px-2 rounded transition-all duration-150 ${
                    i < visiblePitchers.length - 1 ? "border-b border-white/[0.03]" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim w-4 font-data">{i + 1}</span>
                    <Link
                      prefetch={false}
                      href={`/player/${pitcher.id}`}
                      className="text-xs text-text-primary hover:underline"
                    >
                      {pitcher.name}
                    </Link>
                    {(pitcher as any).gyro ? <GyroTag /> : null}
                    <span className="text-[10px] text-text-dim">{pitcher.team}</span>
                  </div>
                  <span className="text-xs font-data font-medium" style={{ color: config.color }}>
                    {pitcher.primaryMetric ? Math.round(pitcher.primaryMetric) : "—"}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer Actions */}
            <div className="px-4 py-2.5 border-t border-border-subtle flex items-center justify-between gap-2">
              {/* Show More / Show Less toggle */}
              <button
                onClick={() => toggleExpand(card.pitchType)}
                className="text-[11px] text-text-dim hover:text-text-secondary transition-all duration-150 active:scale-95"
              >
                {isExpanded ? "Show less ↑" : "Show more ↓"}
              </button>

              {/* Full Leaderboard — heavier CTA */}
              <Link
                href={`/arsenal/${card.pitchType.toLowerCase()}`}
                className="px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200
                  border-border-subtle text-text-secondary
                  hover:border-usf-gold/50 hover:text-usf-gold hover:bg-usf-gold/[0.05]
                  hover:shadow-[0_2px_12px_rgba(232,119,34,0.15)]
                  active:scale-95"
              >
                Full leaderboard →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
