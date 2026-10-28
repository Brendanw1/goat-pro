"use client";

import dynamic from "next/dynamic";
import type { PitchProfileRow, ReleasePoint } from "@/types";

// This split is what keeps ~30 MB of three.js out of every other route. The
// chunk loads only once the 3D scene renders.
const StuffLab = dynamic(() => import("@/components/3d/stuff-lab"), {
  ssr: false,
  loading: () => <div className="h-[600px] animate-pulse rounded-xl bg-white/[0.03]" />,
});

// No playerId: the lab renders purely from the profile's arsenal rows and
// release point, so the MVP ships it with no extra data file.
export function DynamicStuffLab({ pitches, confidence, release, season }: { pitches: PitchProfileRow[]; confidence?: string | null; release?: ReleasePoint | null; season?: number | string | null }) {
  return <StuffLab pitches={pitches} confidence={confidence} release={release} season={season} />;
}
