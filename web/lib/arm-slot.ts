/** Arm slot and movement for the slot, per pitch type (scripts/bake_slot.py). Descriptive, not a grade. */
export interface SlotRow {
  type: string; n: number;
  arm: number | null; armPct: number | null;            // arm angle, degrees (0 sidearm, 90 over the top)
  ivb: number | null; hb: number | null;                 // hb is arm-side positive
  expIvb: number | null; expHb: number | null;           // what his slot, release and extension predict for the type
  dIvb: number | null; dHb: number | null; dIvbPct: number | null; dHbPct: number | null;
  tilt?: string; expTilt?: string; axisDevMin?: number | null; axisDevPct?: number | null;   // four-seam only
}
export interface ArmSlot {
  season: number; throws: string; heightImputed: boolean; minPitches: number; types: SlotRow[];
  /** D1 | D2 | D3 | JUCO | NAIA: the pool his armPct / dIvbPct / dHbPct rank within (with his pitch type). Absent on
   *  fall files and files baked before the non-D1 slot bake = D1 wording. Expectations are from the D1 anchors. */
  level?: string;
  /** Fall only: what the slot anchors predict for every class (no FS / SW) at his primary fastball's release, IVB and
   *  arm-side HB. The Arsenal tab's "Add a pitch" starts an unthrown pitch here (scripts/bake_fall_slot.py). */
  expected?: { from: string; types: Record<string, { ivb: number | null; hb: number | null }> };
}

/** The six arm-slot bands, highest first: [lo, hi) in degrees (0 sidearm, 90 over the top). One list for the profile
 * label and the /arsenal slot board. ponytail: fixed cut points, the release-point proxy reads a few degrees off a
 * measured angle, so a pitcher near a boundary can land in the next band. */
export const SLOT_BANDS = [
  { key: "ott", label: "Over the top", short: "Over top", lo: 60, hi: 101 },
  { key: "high34", label: "High three-quarter", short: "High \u00be", lo: 45, hi: 60 },
  { key: "34", label: "Three-quarter", short: "\u00be", lo: 30, hi: 45 },
  { key: "low34", label: "Low three-quarter", short: "Low \u00be", lo: 15, hi: 30 },
  { key: "side", label: "Sidearm", short: "Side", lo: 0, hi: 15 },
  { key: "sub", label: "Submarine", short: "Sub", lo: -90, hi: 0 },
] as const;
export type SlotBand = (typeof SLOT_BANDS)[number];

export const slotBand = (arm: number): SlotBand => SLOT_BANDS.find((b) => arm >= b.lo) ?? SLOT_BANDS[SLOT_BANDS.length - 1];

/** Plain-language slot from the arm angle. */
export const slotLabel = (arm: number): string => slotBand(arm).label;

/** Pitch types with no expectation of their own, measured against a sibling's: a sweeper against the slider one, a
 * splitter against the changeup one. One map for the slot board and the movement plot; never used when the type
 * has its own expectation. */
export const EXP_BORROW: Record<string, string> = { SW: "SL", FS: "CH" };
