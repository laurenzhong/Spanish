import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  ...(distDir ? { distDir } : {}),
};

export default nextConfig;
