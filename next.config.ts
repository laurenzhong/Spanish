import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  // The documented local URL uses 127.0.0.1; allow Next dev assets from it.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(distDir ? { distDir } : {}),
};

export default nextConfig;
