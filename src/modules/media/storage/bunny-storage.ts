import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { MediaAssetStorage } from "./media-asset-storage";

function required(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

/** Cover images are small; the server only accepts the web-safe raster formats. */
const allowedArtworkContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function createBunnyStorageMediaAssetStorage(): MediaAssetStorage | null {
  const zone = required("BUNNY_STORAGE_ZONE_NAME");
  const password = required("BUNNY_STORAGE_PASSWORD");
  const pullZone = required("BUNNY_STORAGE_PULL_ZONE_HOSTNAME");
  const region = required("BUNNY_STORAGE_REGION") ?? "storage";
  if (!zone || !password || !pullZone) return null;
  if (!/^[a-z0-9-]+$/u.test(zone) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(pullZone)) return null;
  if (!["storage", "de", "sg", "ny", "la", "uk", "se", "br", "jh", "syd"].includes(region)) return null;
  const host = region === "storage" || region === "de" ? "storage.bunnycdn.com" : `${region}.storage.bunnycdn.com`;
  const endpoint = `https://${host}/${encodeURIComponent(zone)}`;
  const headers = { AccessKey: password };
  function encodedPath(path: string): string {
    if (!path.startsWith("media/") || path.split("/").some((part) => !/^[a-zA-Z0-9._-]+$/u.test(part) || part === "." || part === "..")) {
      throw new Error("bunny-storage-path-invalid");
    }
    return path.split("/").map(encodeURIComponent).join("/");
  }
  async function putFile(path: string, filePath: string): Promise<{ url: string }> {
    const info = await stat(filePath);
    if (!info.size) throw new Error("bunny-storage-body-empty");
    const key = encodedPath(path);
    const stream = createReadStream(filePath);
    try {
      const response = await fetch(`${endpoint}/${key}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "video/mp4", "content-length": String(info.size) },
        body: stream as unknown as BodyInit,
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(10 * 60 * 1_000),
      } as RequestInit & { duplex: "half" });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`bunny-storage-upload-${response.status}`);
      return { url: `https://${pullZone}/${key}` };
    } finally {
      stream.destroy();
    }
  }
  return {
    async putAudio(path, body, contentType) {
      if (contentType !== "audio/mpeg" || !body.byteLength) throw new Error("bunny-storage-audio-invalid");
      const key = encodedPath(path);
      const response = await fetch(`${endpoint}/${key}`, {
        method: "PUT",
        headers: { ...headers, "content-type": contentType, "content-length": String(body.byteLength) },
        body: Buffer.from(body),
        redirect: "error",
        signal: AbortSignal.timeout(10 * 60 * 1_000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`bunny-storage-upload-${response.status}`);
      return { url: `https://${pullZone}/${key}` };
    },
    async putVideo(path, body, contentType) {
      if (contentType !== "video/mp4" || !body.byteLength) throw new Error("bunny-storage-video-invalid");
      const key = encodedPath(path);
      const response = await fetch(`${endpoint}/${key}`, { method: "PUT", headers: { ...headers, "content-type": contentType }, body: Buffer.from(body), redirect: "error", signal: AbortSignal.timeout(10 * 60 * 1_000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`bunny-storage-upload-${response.status}`);
      return { url: `https://${pullZone}/${key}` };
    },
    putVideoFromFile: putFile,
    async putArtwork(path, body, contentType) {
      if (!allowedArtworkContentTypes.has(contentType) || !body.byteLength) throw new Error("bunny-storage-artwork-invalid");
      const key = encodedPath(path);
      const response = await fetch(`${endpoint}/${key}`, {
        method: "PUT",
        headers: { ...headers, "content-type": contentType, "content-length": String(body.byteLength) },
        body: Buffer.from(body),
        redirect: "error",
        signal: AbortSignal.timeout(2 * 60 * 1_000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`bunny-storage-upload-${response.status}`);
      return { url: `https://${pullZone}/${key}` };
    },
    async remove(path) {
      const response = await fetch(`${endpoint}/${encodedPath(path)}`, { method: "DELETE", headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new Error(`bunny-storage-delete-${response.status}`);
    },
  };
}
