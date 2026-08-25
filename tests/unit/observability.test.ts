import { describe, expect, it } from "vitest";

import {
  createCorrelationIds,
  recordProviderCallSafely,
  safeProviderErrorType,
} from "@/src/shared/observability";

describe("observability", () => {
  it("creates a request id and preserves only correlation identifiers", () => {
    expect(
      createCorrelationIds({
        requestId: "req_12345678",
        sessionId: "session-1",
        attemptId: "attempt-1",
        conversationId: "conversation-1",
        generationId: "generation-1",
      }),
    ).toEqual({
      requestId: "req_12345678",
      sessionId: "session-1",
      attemptId: "attempt-1",
      conversationId: "conversation-1",
      generationId: "generation-1",
    });
  });

  it("rejects malformed request ids", () => {
    expect(() => createCorrelationIds({ requestId: "short" })).toThrow(
      "requestId has an invalid format",
    );
  });

  it("maps provider errors without exposing messages", () => {
    expect(safeProviderErrorType({ code: "provider-timeout", message: "secret" })).toBe(
      "provider-timeout",
    );
    expect(safeProviderErrorType(new Error("private response"))).toBe("unknown-error");
  });

  it("swallows observer failures", async () => {
    const observer = { record: async () => { throw new Error("database unavailable"); } };
    await expect(
      recordProviderCallSafely(observer, {
        correlation: { requestId: "req_12345678" },
        providerType: "stt",
        provider: "fake",
        status: "failed",
        latencyMs: 10,
      }),
    ).resolves.toBeUndefined();
  });
});
