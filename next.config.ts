import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  // The documented local URL uses 127.0.0.1; allow Next dev assets from it.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // Next 15+ defaults `staleTimes.dynamic` to 0 s, and a route that has a
    // `loading.tsx` is not reused from the client cache at all, so every click
    // on the primary navigation issued a fresh RSC render. Measured before this
    // change: one RSC request per click even for a section visited seconds
    // earlier (31-33 ms once the route was warm, 486-2582 ms while it was not).
    // A 30 s window makes revisiting a section instant; it is short enough that
    // the shelf a user just changed is not shown stale for long, and anything
    // authoritative is still re-checked on the server.
    staleTimes: { dynamic: 30 },
  },
  ...(distDir ? { distDir } : {}),
  // Opt-in escape hatch for a local measurement build while another session's
  // in-flight test files fail the project-wide type check (they do right now:
  // tests/database/lexicon-candidate-reviews-reason.test.ts and some
  // tmp-bisect-*.test.ts). Default off, so `pnpm build` and CI keep failing on
  // real type errors; never set this for a release gate.
  ...(process.env.NEXT_MEASUREMENT_BUILD === "1" ? { typescript: { ignoreBuildErrors: true } } : {}),
  // `public/` is served with `max-age=0`, so every visit revalidated the public
  // home's poster (32 KB) and its recording (990 KB) before reusing them, and
  // `/icon` revalidated its generated PNG. These files only change together with
  // the code that references them, so a day of freshness plus a week of
  // stale-while-revalidate removes those round trips without pinning anything
  // for a year.
  async headers() {
    return [
      {
        source: "/public-home/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/icon",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/apple-icon",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
