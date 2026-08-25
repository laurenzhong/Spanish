import { describe, expect, it, vi } from "vitest";

import { createDrizzleProviderCallRepository } from "@/src/modules/providers/repositories/drizzle-provider-call-repository";

describe("provider call repository", () => {
  it("persists correlation and safe provider metadata without payload content", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const database = { insert: vi.fn(() => ({ values })) };
    const repository = createDrizzleProviderCallRepository(database as never);

    await repository.record({
      userId: "00000000-0000-4000-8000-000000000041",
      correlation: {
        requestId: "req_12345678",
        sessionId: "session-1",
        attemptId: "attempt-1",
        conversationId: "conversation-1",
        generationId: "generation-1",
      },
      providerType: "pronunciation",
      provider: "fake",
      modelVersion: "fake-v1",
      providerRequestId: "provider-1",
      status: "succeeded",
      latencyMs: 42,
      estimatedCostMicros: 12,
      errorType: null,
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req_12345678",
      sessionId: "session-1",
      attemptId: "attempt-1",
      conversationId: "conversation-1",
      generationId: "generation-1",
      providerType: "pronunciation",
      latencyMs: 42,
      metadata: {},
    }));
    expect(JSON.stringify(values.mock.calls[0]?.[0])).not.toContain("secret");
  });
});
