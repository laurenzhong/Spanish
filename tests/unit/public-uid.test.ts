import { describe, expect, it } from "vitest";

import { generatePublicUid, isPublicUid, publicUidColorIndex } from "@/src/modules/account/domain/public-uid";

describe("public uid", () => {
  it("generates a grouped uid without ambiguous characters", () => {
    const uid = generatePublicUid(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(uid).toMatch(/^SN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u);
    expect(isPublicUid(uid)).toBe(true);
    expect(uid).not.toMatch(/[OI01]/u);
  });

  it("maps the same uid to a stable palette index", () => {
    expect(publicUidColorIndex("SN-7K4M-9Q2P", 5)).toBe(publicUidColorIndex("SN-7K4M-9Q2P", 5));
  });
});
