import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { artworkCandidates, MediaArtworkView } from "@/src/modules/media/ui/media-artwork";

afterEach(cleanup);

describe("media artwork", () => {
  it("builds bounded YouTube and podcast fallback candidates", () => {
    expect(artworkCandidates({ url: "https://img.youtube.com/vi/abc123_XYz/mqdefault.jpg", alt: "video", source: "youtube", width: 1280, height: 720, expiresAt: null })).toEqual([
      "https://img.youtube.com/vi/abc123_XYz/mqdefault.jpg",
      "https://i.ytimg.com/vi/abc123_XYz/hqdefault.jpg",
      "https://img.youtube.com/vi/abc123_XYz/hqdefault.jpg",
      "https://i.ytimg.com/vi/abc123_XYz/0.jpg",
      "https://i.ytimg.com/vi/abc123_XYz/default.jpg",
    ]);
    expect(artworkCandidates({ url: "https://is1-ssl.mzstatic.com/image/600x600bb.jpg", alt: "podcast", source: "podcast-feed", width: 600, height: 600, expiresAt: null }).at(-1)).toBe("https://is1-ssl.mzstatic.com/image/100x100bb.jpg");
  });

  it("tries each candidate before showing the missing artwork state", () => {
    render(<MediaArtworkView artwork={{ url: "https://img.youtube.com/vi/abc123_XYz/mqdefault.jpg", alt: "video", source: "youtube", width: 1280, height: 720, expiresAt: null }} kind="video" title="Video" />);
    const image = () => screen.queryByRole("img", { name: "video" }) as HTMLImageElement | null;
    for (let index = 0; index < 5; index += 1) fireEvent.error(image()!);
    expect(screen.getByRole("img", { name: "Video，视频" })).toBeTruthy();
  });
});
