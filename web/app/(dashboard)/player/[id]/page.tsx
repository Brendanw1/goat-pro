import { getPlayerProfile, getHitterProfile } from "@/lib/data";
import { PlayerPage } from "./player-page";
import { CareerByLevel } from "@/components/ui/career-by-level";
import { notFound } from "next/navigation";
import { isId, isSeason } from "@/lib/r2";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const season = (await searchParams)?.season;
  if (!isId(id) || (season != null && season !== "" && !isSeason(season))) notFound();
  const [file, hitter] = await Promise.all([
    getPlayerProfile(id, season, "mlb", { noBoardFallback: true }),
    getHitterProfile(id, season),
  ]);
  const profile = file ?? hitter ?? (await getPlayerProfile(id, season));
  const yr = profile?.season ? ` (${profile.season})` : "";
  return { title: profile?.name ? `${profile.name}${yr}` : "Player Not Found" };
}

export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ season?: string; tab?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  if (!isId(id) || (sp.season != null && sp.season !== "" && !isSeason(sp.season))) notFound();
  return <PlayerPage id={id} season={sp.season} tab={sp.tab} extra={<CareerByLevel id={id} />} />;
}
