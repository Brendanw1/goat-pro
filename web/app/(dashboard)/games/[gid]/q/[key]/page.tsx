import { notFound } from "next/navigation";
import { decodeQueryKey } from "@/lib/query-key";
import View from "../../view";

/** Every request for /games/[gid] (with or without a query) is rewritten here by proxy.ts: one cached render per view. */
export const revalidate = 86400;
export async function generateStaticParams() { return []; } // thousands of ids: render on first request, then cached

export default async function GameQueryPage({ params }: { params: Promise<{ gid: string; key: string }> }) {
  const q = decodeQueryKey((await params).key);
  if (!q) notFound();
  return <View params={params} searchParams={Promise.resolve(q)} />;
}
