import { getPlayerProfile, getHitterProfile } from "@/lib/data";
import { PlayerPage } from "./player-page";
import { CareerByLevel } from "@/components/ui/career-by-level";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const season = (await searchParams)?.season;
  const profile = (await getPlayerProfile(id, season)) ?? (await getHitterProfile(id, season));
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
  return <PlayerPage id={id} season={sp.season} tab={sp.tab} extra={<CareerByLevel id={id} />} />;
}
