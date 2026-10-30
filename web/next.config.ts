import type { NextConfig } from "next";
import path from "path";

// Security audit M2 (2026-10-30). Built from the sources the site really loads: headshots from img.mlbstatic.com,
// clips from sporty-clips.mlb.com, everything else same-origin (Vercel Analytics is served at /_vercel/*).
// 'unsafe-inline' scripts: Next's inline flight scripts + launch-intro; a nonce would force dynamic rendering.
// Report-Only for now: flip the key to Content-Security-Policy once the console stays clean in production.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.mlbstatic.com",
  "media-src 'self' https://sporty-clips.mlb.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // add "upgrade-insecure-requests" when enforcing; browsers log an error for it in a Report-Only policy
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy-Report-Only", value: CSP },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
  // Pin the workspace root to this directory.
  //
  // There is a package-lock.json two levels up in ~/Projects/vt_baseball, so
  // Turbopack inferred THAT as the root and resolved from its node_modules —
  // which carries react@18.3.1 while this app is on 19. Two React copies means
  // a ref created by one instance is never populated by the other, which is
  // what made @react-three/fiber call events.connect(null) and leave every
  // Canvas rendering its clear colour and nothing else.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Static image optimization disabled (we serve from R2)
  images: {
    unoptimized: true,
  },
  // Strict mode for catching bugs early
  reactStrictMode: true,
  // Environment variable validation at build time
  env: {
    NEXT_PUBLIC_APP_NAME: "GOAT",
  },
};

export default nextConfig;
