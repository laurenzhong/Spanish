import { NextRequest, NextResponse } from "next/server";

const allowedHosts = new Set(["img.youtube.com", "i.ytimg.com"]);
const imagePath = /^\/vi\/[A-Za-z0-9_-]{6,64}\/(?:[A-Za-z0-9_-]+)\.(?:jpe?g|webp|png)$/u;

function isAllowedArtworkUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.username || url.password || url.search || url.hash || !imagePath.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = isAllowedArtworkUrl(request.nextUrl.searchParams.get("url") ?? "");
  if (!url) return new NextResponse(null, { status: 400 });
  try {
    // The direct YouTube image hosts are blocked in some supported browser
    // networks. Weserv retrieves the same public thumbnail and returns it as
    // an image, while the allowlist above keeps this endpoint non-generic.
    const proxyUrl = new URL("https://images.weserv.nl/");
    proxyUrl.searchParams.set("url", `${url.hostname}${url.pathname}`);
    const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8_000), headers: { accept: "image/avif,image/webp,image/jpeg,image/png" } });
    if (!response.ok) return new NextResponse(null, { status: response.status === 404 ? 404 : 502 });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
    if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) return new NextResponse(null, { status: 502 });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) return new NextResponse(null, { status: 502 });
    return new NextResponse(bytes, {
      headers: {
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
