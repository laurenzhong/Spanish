import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { POST } from "@/app/api/v1/conversations/[characterId]/stream/route";
import { GET } from "@/app/api/v1/conversations/[characterId]/route";

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

vi.mock("@/src/modules/providers/conversation/server", () => ({
  createMiniMaxConversationProvider: vi.fn(),
}));

const mockedVerifyRequestUser = vi.mocked(verifyRequestUser);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

describe("conversation stream route authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the Web session cookie when no bearer token is present", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue({ id: "web-user", email: "web@example.test" });
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characterVersion: 1,
        text: "hola",
        clientMessageId: "client-1",
        generationId: "generation-1",
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"meta"');
    expect(body).toContain('"type":"done"');
    expect(mockedGetCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("requires authentication before reading conversation history", async () => {
    mockedVerifyRequestUser.mockResolvedValue(null);
    mockedGetCurrentUser.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia");
    const response = await GET(request, { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(401);
  });
});
