import { notFound } from "next/navigation";
import { getPitchers } from "@/lib/data";
import { decodeQueryKey } from "@/lib/query-key";
import View from "../../view";
export { metadata } from "../../view";

/** Every request for /teams/[abbr] (with or without a query) is rewritten here by proxy.ts: one cached render per view. */
export const revalidate = 86400;
/** The 30 clubs' default views prebuilt; other views render on first request. */
export async function generateStaticParams() {
  const teams = new Set((await getPitchers() ?? []).map((r: any) => r.team).filter(Boolean));
  return [...teams].map((t) => ({ abbr: String(t).toLowerCase(), key: "_" }));
}

export default async function TeamQueryPage({ params }: { params: Promise<{ abbr: string; key: string }> }) {
  const q = decodeQueryKey((await params).key);
  if (!q) notFound();
  return <View params={params} searchParams={Promise.resolve(q)} />;
}
