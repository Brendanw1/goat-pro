import { getArsenalBoardRows, getPercentiles } from "@/lib/data";
import { PITCH_CONFIG } from "@/lib/constants";
import { arsenalProps } from "@/lib/boards/arsenal";
import { ArsenalExpanded } from "./expanded";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pitch: string }>;
}) {
  const { pitch } = await params;
  const code = pitch.toUpperCase();
  const named = PITCH_CONFIG[code as keyof typeof PITCH_CONFIG];
  return { title: `${named?.label ?? code} Leaderboard` };
}

export default async function ArsenalPitchPage({
  params,
  searchParams,
}: {
  params: Promise<{ pitch: string }>;
  searchParams?: Promise<{ level?: string }>;
}) {
  const { pitch } = await params;
  const level = (await searchParams)?.level === "aaa" ? "aaa" : "mlb";
  const [data, percentiles] = await Promise.all([
    getArsenalBoardRows(pitch, level),
    getPercentiles(null, level),
  ]);
  const code = pitch.toUpperCase();

  return (
    <div className="space-y-3">
      <DescriptiveChip />
      <span className="sr-only">{DESCRIPTIVE_LINE}</span>
      <ArsenalExpanded
        pitchType={code}
        level={level}
        // PQ is not graded for every type (four-seamers, sinkers, cutters): no column at all rather than a column of dashes.
        hasPq={data.some((r: any) => typeof r.pitchQuality === "number")}
        // Meta and the first page only; ff.json alone is 11 MB (lib/boards/shared.ts).
        {...arsenalProps(data)}
        breakpoints={percentiles?.pitchers_per_type?.[code] ?? null}
      />
    </div>
  );
}
