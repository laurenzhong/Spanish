import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transcribe = vi.fn();
vi.mock("@/src/modules/providers/stt/server", () => ({ createOpenAITranscriptionProvider: () => ({ transcribe }) }));
const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  verifyRequestUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/src/shared/auth/server", () => authMocks);

import { POST } from "@/app/api/v1/transcriptions/route";

describe("transcription route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transcribes ephemeral audio and returns only the transcript fields", async () => {
    transcribe.mockResolvedValue({ text: "Hola desde voz", confidence: null, confidenceAvailability: "unavailable", retentionPolicy: "ephemeral" });
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3])], "voice.webm", { type: "audio/webm" }));
    const response = await POST({ formData: async () => form, headers: new Headers(), signal: new AbortController().signal } as unknown as NextRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { text: "Hola desde voz", confidence: null, confidenceAvailability: "unavailable", retentionPolicy: "ephemeral" } });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "audio/webm", fileName: "voice.webm" }), expect.any(Object));
  });

  it("rejects requests without an audio file", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/transcriptions", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(400);
  });

  it("does not fall back to the cookie identity for an invalid bearer", async () => {
    const request = new NextRequest("http://localhost/api/v1/transcriptions", {
      method: "POST",
      headers: { authorization: "Bearer invalid" },
      body: new FormData(),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(authMocks.getCurrentUser).not.toHaveBeenCalled();
    expect(authMocks.verifyRequestUser).toHaveBeenCalledWith(request);
  });
});
