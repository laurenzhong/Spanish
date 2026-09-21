import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  typescript: {
    // Keep test-only packages out of the production application typecheck.
    // The repository-level `pnpm typecheck` still checks the complete workspace.
    tsconfigPath: "tsconfig.next.json",
  },
  // The documented local URL uses 127.0.0.1; allow Next dev assets from it.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(distDir ? { distDir } : {}),
};

export default nextConfig;
