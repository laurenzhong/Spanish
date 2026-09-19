import { describe, expect, it } from "vitest";
import { canRelocateHostedVideoReferences, finalMediaHeaders, validateHostedSource, validateMediaRange } from "@/src/modules/media/storage/hosted-video-integrity";

describe("hosted video integrity gates", () => {
  it("relocates only authorized video references for the exact same media identity", () => {
    const ref = { kind: "video", provider_key: "supabase-storage:media-video", stable_key: "youtube.fixture", copyright_status: "cleared" };
    expect(canRelocateHostedVideoReferences("youtube.fixture", [])).toBe(true);
    expect(canRelocateHostedVideoReferences("youtube.fixture", [ref, ref])).toBe(true);
    for (const invalid of [{ ...ref, kind: "audio" }, { ...ref, provider_key: "youtube" }, { ...ref, stable_key: "youtube.other" }, { ...ref, copyright_status: "restricted" }]) {
      expect(canRelocateHostedVideoReferences("youtube.fixture", [ref, invalid])).toBe(false);
    }
  });
  const raw = "HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 206\r\ncontent-type: video/mp4\r\ncontent-range: bytes 4-7/12\r\ncontent-length: 4\r\n\r\n";
  it("uses the final response and accepts only exact range bytes", () => {
    expect(finalMediaHeaders(raw).status).toBe(206);
    expect(() => validateMediaRange(raw, 4, 7, 12, 4)).not.toThrow();
  });
  it.each([
    raw.replace("bytes 4-7/12", "bytes 0-3/12"),
    raw.replace("bytes 4-7/12", "bytes 4-7/20"),
    raw.replace("HTTP/2 206", "HTTP/2 200"),
    raw.replace("content-length: 4", "content-length: 3"),
  ])("rejects wrong offsets, changed objects, ignored range, and truncation", (headers) => {
    expect(() => validateMediaRange(headers, 4, 7, 12, 4)).toThrow("MEDIA_RANGE_INVALID");
  });
  it("rejects a partial body and non-video content", () => {
    expect(() => validateMediaRange(raw, 4, 7, 12, 3)).toThrow("MEDIA_RANGE_INVALID");
    expect(() => validateMediaRange(raw.replace("video/mp4", "text/html"), 4, 7, 12, 4)).toThrow("MEDIA_MIME_INVALID");
  });
  it("accepts only configured public video objects, without credentials or tokens", () => {
    const origin = "https://project.supabase.co";
    const url = `${origin}/storage/v1/object/public/media-video/media/item/1/video.mp4`;
    expect(validateHostedSource(url, origin).origin).toBe(origin);
    for (const bad of [url.replace("project", "other"), `${url}?token=secret`, url.replace("https://", "https://user:pass@"), url.replace("media-video", "private")]) {
      expect(() => validateHostedSource(bad, origin)).toThrow("MEDIA_SOURCE_INVALID");
    }
  });
});
