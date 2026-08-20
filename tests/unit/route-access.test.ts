import { describe, expect, it } from "vitest";

import { resolveAuthRedirect } from "@/src/shared/auth/route-access";

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
});
