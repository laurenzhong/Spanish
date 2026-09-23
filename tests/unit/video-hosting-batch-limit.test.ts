import { describe, expect, it } from "vitest";

import { getMediaVideoHostingBatchLimit } from "@/src/modules/content-acquisition/media/video-hosting-batch-limit";

describe("getMediaVideoHostingBatchLimit", () => {
  it("caps a canary run at one candidate even when the daily quota is full", () => {
    expect(getMediaVideoHostingBatchLimit(10, 10, true)).toBe(1);
  });

  it("keeps regular hosting limited to the remaining daily quota", () => {
    expect(getMediaVideoHostingBatchLimit(10, 7, false)).toBe(3);
    expect(getMediaVideoHostingBatchLimit(10, 10, false)).toBe(0);
  });
});
