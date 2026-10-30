import { notFound } from "next/navigation";
import { decodeQueryKey } from "@/lib/query-key";
import View, { generateMetadata as viewMetadata } from "../../view";

/** Every request for /minors/player/[id] (with or without a query) is rewritten here by proxy.ts: one cached render per view. */
export const revalidate = 86400;
export async function generateStaticParams() { return []; } // thousands of ids: render on first request, then cached

type P = { params: Promise<{ id: string; key: string }> };
const query = async (params: P["params"]) => {
  const q = decodeQueryKey((await params).key);
  if (!q) notFound();
  return q;
};

export async function generateMetadata({ params }: P) {
  return viewMetadata({ params, searchParams: query(params) });
}

export default function MinorsPlayerQueryPage({ params }: P) {
  return <View params={params} searchParams={query(params)} />;
}
