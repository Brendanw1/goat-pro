"use client";

interface VAAGridCell {
  zone_x: string;
  zone_z: string;
  avg_vaa: number;
  n: number;
}

interface VAAGridProps {
  data: VAAGridCell[];
  /** Background per "zone_z-zone_x" (e.g. the cell's D1 percentile colour); replaces the fixed VAA ramp for that cell. */
  tints?: Record<string, string>;
}

/**
 * Map VAA value to a background color.
 * Flatter (less negative, -4 to -5) = green (good)
 * Mid-range (-5 to -7) = neutral/grey
 * Steeper (-7+) = orange/red (bad for fastballs)
 */
function vaaColor(vaa: number): string {
  const v = Math.abs(vaa); // work with positive magnitude
  if (v <= 4.5) return "rgba(78, 173, 91, 0.55)"; // green — very flat
  if (v <= 5.0) return "rgba(78, 173, 91, 0.35)"; // light green
  if (v <= 5.5) return "rgba(78, 173, 91, 0.15)"; // hint of green
  if (v <= 6.0) return "rgba(255, 255, 255, 0.06)"; // neutral
  if (v <= 6.5) return "rgba(255, 255, 255, 0.06)"; // neutral
  if (v <= 7.0) return "rgba(232, 112, 72, 0.2)"; // hint of orange
  if (v <= 7.5) return "rgba(232, 112, 72, 0.35)"; // orange
  if (v <= 8.0) return "rgba(232, 65, 66, 0.35)"; // orange-red
  return "rgba(232, 65, 66, 0.5)"; // red — very steep
}

// Column labels (batter's perspective)
const COL_LABELS = ["Arm", "Mid", "Glove"];
const ROW_LABELS = ["High", "Mid", "Low"];

// Map zone_x values to column index
const X_MAP: Record<string, number> = { arm: 0, mid: 1, glove: 2 };
// Map zone_z values to row index (high = top = row 0)
const Z_MAP: Record<string, number> = { high: 0, mid: 1, low: 2 };

export function VAAGrid({ data, tints }: VAAGridProps) {
  if (!data || data.length === 0) return null;

  // Build 3x3 grid
  const grid: (VAAGridCell | null)[][] = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];

  for (const cell of data) {
    const col = X_MAP[cell.zone_x.toLowerCase()];
    const row = Z_MAP[cell.zone_z.toLowerCase()];
    if (col !== undefined && row !== undefined) {
      grid[row][col] = cell;
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex">
        {/* Row labels */}
        <div className="flex flex-col justify-around pr-1.5 py-0.5">
          {ROW_LABELS.map((label) => (
            <div
              key={label}
              className="flex items-center justify-end h-[50px] text-[10px] text-text-dim"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-3 gap-[3px]">
          {grid.flat().map((cell, i) => {
            const hasData = cell && cell.n > 0;
            const tint = hasData && tints ? tints[`${cell.zone_z.toLowerCase()}-${cell.zone_x.toLowerCase()}`] : undefined;
            const bg = !hasData ? "rgba(255,255,255,0.02)" : tints ? (tint ?? "rgba(255,255,255,0.06)") : vaaColor(cell.avg_vaa);
            return (
              <div
                key={i}
                className="flex flex-col items-center justify-center rounded"
                style={{
                  width: 60,
                  height: 50,
                  backgroundColor: bg,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {hasData ? (
                  <>
                    <span className="text-xs font-data font-medium text-text-primary">
                      {cell.avg_vaa.toFixed(1)}°
                    </span>
                    <span className="text-[10px] text-text-dim">
                      n={cell.n}
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-text-dim">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Column labels */}
      <div className="flex pl-[28px] pt-1">
        {COL_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] text-text-dim"
            style={{ width: 60, marginRight: 3 }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
