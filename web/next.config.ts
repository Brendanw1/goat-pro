import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
