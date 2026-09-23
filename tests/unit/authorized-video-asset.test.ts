import { describe, expect, it } from "vitest";

import { resolveAuthorizedVideoAssetPath } from "@/src/modules/content-acquisition/media/authorized-video-asset";

describe("resolveAuthorizedVideoAssetPath", () => {
  it("maps an authorized asset directory to one candidate-specific MP4", () => {
    expect(resolveAuthorizedVideoAssetPath("D:/approved-media", "6c995735-c900-497a-8fe3-a4f17b661d3c"))
      .toBe("D:\\approved-media\\6c995735-c900-497a-8fe3-a4f17b661d3c.mp4");
  });

  it("returns no local asset directory when unset", () => {
    expect(resolveAuthorizedVideoAssetPath(undefined, "6c995735-c900-497a-8fe3-a4f17b661d3c")).toBeNull();
  });

  it("rejects candidate path traversal", () => {
    expect(() => resolveAuthorizedVideoAssetPath("D:/approved-media", "../../source.mp4"))
      .toThrow("CONTENT_CANDIDATE_ID_INVALID");
  });
});
