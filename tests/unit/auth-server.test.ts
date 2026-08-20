import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  type AccessTokenVerifier,
  verifyRequestUser,
} from "@/src/shared/auth/server";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/v1/auth/session", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("verifyRequestUser", () => {
  it("rejects a request without a bearer token", async () => {
    const verify = vi.fn();
    expect(
      await verifyRequestUser(request(), { verify } as AccessTokenVerifier),
    ).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a token the authority cannot verify", async () => {
    const verify = vi.fn().mockResolvedValue(null);
    expect(
      await verifyRequestUser(request("Bearer invalid"), { verify }),
    ).toBeNull();
    expect(verify).toHaveBeenCalledWith("invalid");
  });

  it("returns only the identity verified by the authority", async () => {
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "learner@example.test",
    };
    const verify = vi.fn().mockResolvedValue(user);

    await expect(
      verifyRequestUser(request("Bearer signed-token"), { verify }),
    ).resolves.toEqual(user);
  });
});
