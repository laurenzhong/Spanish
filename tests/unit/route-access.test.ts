import { describe, expect, it } from "vitest";

import {
  resolveAuthRedirect,
  resolvePostLoginTarget,
} from "@/src/shared/auth/route-access";

describe("resolveAuthRedirect", () => {
  it("sends anonymous product traffic to login with the original path", () => {
    expect(resolveAuthRedirect("/learn", false)).toBe(
      "/login?next=%2Flearn",
    );
  });

  it("sends authenticated users away from login", () => {
    expect(resolveAuthRedirect("/login", true)).toBe("/learn");
  });

  it("keeps the public introduction page available", () => {
    expect(resolveAuthRedirect("/", false)).toBeNull();
  });

  it("keeps a valid internal destination after login", () => {
    expect(resolvePostLoginTarget("/chat/lucia?from=invite")).toBe(
      "/chat/lucia?from=invite",
    );
  });

  it("rejects external and login destinations after login", () => {
    expect(resolvePostLoginTarget("https://example.com")).toBe("/learn");
    expect(resolvePostLoginTarget("//example.com")).toBe("/learn");
    expect(resolvePostLoginTarget("/login?next=/me")).toBe("/learn");
  });
});
