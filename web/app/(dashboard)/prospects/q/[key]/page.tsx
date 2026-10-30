import { notFound } from "next/navigation";
import { decodeQueryKey } from "@/lib/query-key";
import View from "../../view";
export { metadata } from "../../view";

/** Every request for /prospects (with or without a query) is rewritten here by proxy.ts: one cached render per view. */
export const revalidate = 86400;
export async function generateStaticParams() { return [{ key: "_" }]; } // the default view, prebuilt

export default async function ProspectsQueryPage({ params }: { params: Promise<{ key: string }> }) {
  const q = decodeQueryKey((await params).key);
  if (!q) notFound();
  return <View searchParams={Promise.resolve(q)} />;
}
