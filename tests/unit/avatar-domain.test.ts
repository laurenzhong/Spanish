import { describe, expect, it } from "vitest";

import { initialsForDisplayName } from "@/src/modules/account/domain/avatar";
import { validateAccountProfilePatch } from "@/src/modules/account/domain/account-profile";

describe("account avatar domain", () => {
  it("uses the first user-visible character for initials", () => {
    expect(initialsForDisplayName("  María  ")).toBe("M");
    expect(initialsForDisplayName("")).toBe("你");
  });

  it("requires a preset id when selecting a preset avatar", () => {
    expect(() => validateAccountProfilePatch({ avatarKind: "preset" })).toThrow("missing-avatar-preset");
    expect(validateAccountProfilePatch({ avatarKind: "initials", displayName: "Ana" })).toEqual({ avatarKind: "initials", displayName: "Ana" });
  });
});
