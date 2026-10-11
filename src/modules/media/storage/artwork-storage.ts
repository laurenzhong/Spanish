import { createHash } from "node:crypto";

import type { MediaArtwork } from "../domain";
import { createBunnyStorageMediaAssetStorage } from "./bunny-storage";
import type { MediaAssetStorage } from "./media-asset-storage";

/**
 * Copies cover art into storage this product owns.
 *
 * Publisher artwork arrives as a remote URL that may be signed, rate limited or
 * rotated, so a published version must not point at it directly: the snapshot is
 * taken while the candidate is published and the stored copy becomes the
 * version's artwork.
 */
export type MediaArtworkStorage = Readonly<{
  snapshot(input: Readonly<{ stableKey: string; revision: number; artwork: MediaArtwork }>): Promise<MediaArtwork>;
}>;

const artworkContentTypeExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
/** Cover art is small; anything larger is not a cover and is refused. */
const maxArtworkBytes = 5 * 1024 * 1024;
const downloadTimeoutMs = 30_000;
const maxRedirects = 4;
/** Path segments stay inside the storage bucket the media assets already use. */
const stableKeyPattern = /^[a-z0-9][a-z0-9._-]*$/u;

/**
 * Fails closed when storage is not configured, so publishing artwork never
 * silently falls back to a remote URL the product does not control.
 */
export function createBunnyStorageMediaArtworkStorage(): MediaArtworkStorage | null {
  const storage = createBunnyStorageMediaAssetStorage();
  return storage ? createMediaArtworkStorage(storage) : null;
}

export function createMediaArtworkStorage(storage: MediaAssetStorage): MediaArtworkStorage {
  return {
    async snapshot(input) {
      if (!stableKeyPattern.test(input.stableKey)) throw new Error("artwork-stable-key-invalid");
      if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error("artwork-revision-invalid");

      // Redirects are followed by hand so every hop is re-validated: artwork
      // hosts are third parties, and a redirect must not turn this into a
      // request for anything other than a public https image.
      let current = parseArtworkUrl(input.artwork.url);
      let response: Response | null = null;
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const attempt = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(downloadTimeoutMs) });
        if (attempt.status >= 300 && attempt.status < 400) {
          const location = attempt.headers.get("location");
          await attempt.body?.cancel().catch(() => undefined);
          if (!location) throw new Error("artwork-redirect-missing-location");
          current = parseArtworkUrl(new URL(location, current).toString());
          continue;
        }
        response = attempt;
        break;
      }
      if (!response) throw new Error("artwork-redirect-limit-exceeded");

      try {
        if (!response.ok) throw new Error(`artwork-download-${response.status}`);
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        const extension = artworkContentTypeExtensions.get(contentType);
        if (!extension) throw new Error("artwork-content-type-unsupported");
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isSafeInteger(declaredLength) && declaredLength > maxArtworkBytes) {
          throw new Error("artwork-too-large");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0) throw new Error("artwork-empty");
        if (bytes.byteLength > maxArtworkBytes) throw new Error("artwork-too-large");

        const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
        const path = `media/artwork/${input.stableKey}/v${input.revision}-${digest}.${extension}`;
        const { url } = await storage.putArtwork(path, bytes, contentType);
        return {
          url,
          alt: input.artwork.alt,
          source: input.artwork.source,
          // The snapshot lives in our own storage, so it never expires.
          width: input.artwork.width,
          height: input.artwork.height,
          expiresAt: null,
        };
      } finally {
        await response.body?.cancel().catch(() => undefined);
      }
    },
  };
}

function parseArtworkUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("artwork-url-invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("artwork-url-unsafe");
  return url;
}
