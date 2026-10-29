import Link from "next/link";

/** Deploys replace the route bundle; a link clicked mid-deploy can 404 for a page that exists. */
export default function NotFound() {
  return (
    <div className="glass-panel p-10 text-center space-y-3">
      <p className="text-2xl font-semibold text-text-primary">404</p>
      <p className="text-sm text-text-secondary">This page could not be found.</p>
      <p className="text-xs text-text-dim max-w-[52ch] mx-auto">
        If you followed a link from this site, the page may exist but the site was redeploying when you
        clicked — retrace via the navigation above, or try again in a moment.
      </p>
      <Link href="/" className="inline-block text-xs text-text-secondary hover:underline">Back to the home page</Link>
    </div>
  );
}
