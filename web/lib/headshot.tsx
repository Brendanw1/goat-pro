/**
 * Player headshots (D-32): MLB's official photo CDN, hot-linked. The
 * `d_people:generic:headshot` default in the URL means the CDN itself serves a
 * silhouette for any id without a photo, so there is no client fallback to
 * manage. `w_` + `q_auto` do the sizing server-side; the 2x srcSet covers
 * retina without shipping the 426px original to a thumbnail.
 *
 * Terms: MLB Advanced Media content, like the Savant data — attribution lives
 * in the README. The polite mirror in pipeline/headshots.py is an insurance
 * copy in R2 (headshots/{id}.png); the site reads the CDN directly so photos
 * stay current and our bucket holds nothing load-bearing.
 */
export function headshotUrl(id: string | number, w: 64 | 128 | 256 | 426 = 128): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_${w},q_auto:best/v1/people/${id}/headshot/67/current`;
}

export function Headshot({ id, size = 44, alt }: { id: string | number; size?: number; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images.unoptimized is set; a plain img carries the 2x srcSet
    <img
      src={headshotUrl(id, size >= 40 ? 128 : 64)}
      srcSet={`${headshotUrl(id, size >= 40 ? 128 : 64)} 1x, ${headshotUrl(id, 256)} 2x`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-full object-cover ring-1 ring-white/15 bg-black/40"
      style={{ width: size, height: size }}
      onError={(e) => {
        // the CDN's generic avatar should always answer; hide rather than show a broken image if it ever does not
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}
