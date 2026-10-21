import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";

const mocks = vi.hoisted(() => {
  const userMessage = {
    id: "10000000-0000-4000-8000-000000000041",
    clientMessageId: "client-1",
    generationId: "generation-1",
    role: "user" as const,
    status: "completed" as const,
    content: "Hola",
    replyToMessageId: null,
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    completedAt: new Date("2026-08-24T00:00:00.000Z"),
  };
  return {
    userMessage,
    repository: {
      claimReplyGeneration: vi.fn(),
      saveReplyPrefix: vi.fn().mockResolvedValue(true),
      finishReplyGeneration: vi.fn(),
      cancelReplyGeneration: vi.fn().mockResolvedValue(true),
      getOrCreateConversation: vi.fn().mockResolvedValue("20000000-0000-4000-8000-000000000042"),
      appendUserMessage: vi.fn().mockResolvedValue(userMessage),
      completeAssistantMessage: vi.fn().mockResolvedValue({ ...userMessage, id: "30000000-0000-4000-8000-000000000043", role: "character", content: "reply" }),
      findAssistantMessage: vi.fn(),
      listMessages: vi.fn(),
      isMessageWithdrawn: vi.fn().mockResolvedValue(false),
    },
    verifyRequestUser: vi.fn().mockResolvedValue(null),
    getCurrentUser: vi.fn().mockResolvedValue({ id: "40000000-0000-4000-8000-000000000044", email: "test@example.test" }),
    getLuciaContact: vi.fn().mockResolvedValue({ status: "active", relationshipStage: "familiar", relationshipSummary: "Hablamos de fotografía." }),
    memoryRepository: {},
    memoryCandidate: {
      candidateId: "memory-candidate-1",
      userId: "40000000-0000-4000-8000-000000000044",
      characterKey: "lucia",
      characterVersion: 1,
      conversationId: "20000000-0000-4000-8000-000000000042",
      sourceMessageId: "10000000-0000-4000-8000-000000000041",
      factKey: "interest.preference",
      category: "interest" as const,
      content: "la fotografía",
      confidence: 0.9,
      sensitivity: "normal" as const,
      shareScope: "private" as const,
    },
    commitMemories: vi.fn().mockResolvedValue([]),
    provider: {
      generate: vi.fn().mockResolvedValue({
        text: "Estoy bien, gracias.",
        provider: "minimax" as const,
        modelVersion: "test-provider",
        providerRequestId: "provider-request-1",
        latencyMs: 1,
        estimatedCostMicros: null,
      }),
    },
  };
});

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

vi.mock("@/src/shared/db/client", () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock("@/src/modules/providers/conversation/server", () => ({
  createMiniMaxConversationProvider: vi.fn(() => mocks.provider),
}));

vi.mock("@/src/modules/conversation", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/conversation")>("@/src/modules/conversation");
  return {
    ...actual,
    createDrizzleConversationRepository: vi.fn(() => mocks.repository),
  };
});

vi.mock("@/src/modules/character-network", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/character-network")>("@/src/modules/character-network");
  return {
    ...actual,
    createDrizzleLuciaContactRepository: vi.fn(() => ({ get: mocks.getLuciaContact })),
  };
});

vi.mock("@/src/modules/memory", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/memory")>("@/src/modules/memory");
  return {
    ...actual,
    createDrizzleMemoryRepository: vi.fn(() => mocks.memoryRepository),
    extractMemories: vi.fn(() => [mocks.memoryCandidate]),
    commitMemories: mocks.commitMemories,
  };
});

import { GET } from "@/app/api/v1/conversations/[characterId]/route";
import { POST as STREAM_POST } from "@/app/api/v1/conversations/[characterId]/stream/route";
import { extractMemories } from "@/src/modules/memory";

describe("conversation stream persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractMemories).mockImplementation(() => [mocks.memoryCandidate]);
    mocks.provider.generate.mockResolvedValue({ text: "Estoy bien, gracias.", provider: "minimax", modelVersion: "test-provider", providerRequestId: "provider-request-1", latencyMs: 1, estimatedCostMicros: null });
    mocks.repository.saveReplyPrefix.mockReset().mockResolvedValue(true);
    mocks.repository.isMessageWithdrawn.mockReset().mockResolvedValue(false);
    mocks.repository.listMessages.mockResolvedValue([]);
    mocks.repository.claimReplyGeneration.mockImplementation(async (input) => {
      const userMessages = [];
      for (const pending of input.messages) userMessages.push(await mocks.repository.appendUserMessage({
        userId: input.userId, conversationId: input.conversationId, characterKey: input.characterKey, generationId: input.generationId,
        clientMessageId: pending.clientMessageId, content: pending.text, ...(pending.assistance ? { sourceType: "translation_assisted" } : {}),
      }));
      return { status: "claimed", userMessages, assistant: { ...mocks.userMessage, id: input.messageId, role: "character", status: "streaming", content: "" } };
    });
    mocks.repository.finishReplyGeneration.mockImplementation(async (input) => mocks.repository.completeAssistantMessage({
      ...input, characterKey: "lucia", messageId: "30000000-0000-4000-8000-000000000043", clientMessageId: `assistant-${input.generationId}`, replyToMessageId: mocks.userMessage.id,
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.MINIMAX_API_KEY;
  });

  function request(extension: Record<string, unknown> = {}) {
    return new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hola", clientMessageId: "client-1", generationId: "generation-1", ...extension }),
    });
  }

  it("validates the entire batch before claiming or writing anything", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    const response = await STREAM_POST(request({ pendingMessages: [{ text: "x".repeat(2001), clientMessageId: "earlier" }] }), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(400);
    expect(mocks.repository.claimReplyGeneration).not.toHaveBeenCalled();
    expect(mocks.repository.appendUserMessage).not.toHaveBeenCalled();
    expect(mocks.provider.generate).not.toHaveBeenCalled();
  });

  it("claims a batch before context reads and keeps the latest message out of duplicate history", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    process.env.MINIMAX_API_KEY = "test-key";
    const earlier = { ...mocks.userMessage, id: "earlier-uuid", clientMessageId: "earlier", content: "Me gusta la fotografía." };
    mocks.repository.listMessages.mockResolvedValue([earlier, { ...mocks.userMessage, content: "He comprado un libro." }]);
    const response = await STREAM_POST(request({ text: "He comprado un libro.", pendingMessages: [{ clientMessageId: "earlier", text: earlier.content }] }), { params: Promise.resolve({ characterId: "lucia" }) });
    await response.text();
    expect(mocks.repository.appendUserMessage).toHaveBeenCalledTimes(2);
    expect(mocks.repository.claimReplyGeneration.mock.invocationCallOrder[0]).toBeLessThan(mocks.repository.listMessages.mock.invocationCallOrder[0]);
    expect(mocks.provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: "He comprado un libro.",
      unansweredUserMessages: [earlier.content, "He comprado un libro."],
      recentMessages: [expect.objectContaining({ role: "user", content: earlier.content })],
    }), expect.anything());
  });

  it("persists complete prefixes before done and extracts memory once for the full turn", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    process.env.MINIMAX_API_KEY = "test-key";
    mocks.provider.generate.mockResolvedValue({ text: "Estoy bien, gracias.\n\nHoy tengo un rato tranquilo.", provider: "minimax", modelVersion: "test-provider", providerRequestId: "provider-request-1", latencyMs: 1, estimatedCostMicros: null });
    const response = await STREAM_POST(request(), { params: Promise.resolve({ characterId: "lucia" }) });
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => event.type === "delta").map((event) => event.text)).toEqual(["Estoy bien, gracias.", "\n\nHoy tengo un rato tranquilo."]);
    expect(mocks.repository.saveReplyPrefix.mock.calls.map(([call]) => call.prefix)).toEqual(["Estoy bien, gracias.", "Estoy bien, gracias.\n\nHoy tengo un rato tranquilo."]);
    expect(mocks.repository.saveReplyPrefix.mock.invocationCallOrder[1]).toBeLessThan(mocks.repository.finishReplyGeneration.mock.invocationCallOrder[0]);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(mocks.commitMemories).toHaveBeenCalledTimes(1);
  });

  it("extracts every claimed batch source once after the whole reply completes", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    const earlier = { ...mocks.userMessage, id: "earlier-source", clientMessageId: "earlier", content: "Me gusta la fotografía." };
    mocks.repository.claimReplyGeneration.mockResolvedValueOnce({ status: "claimed", userMessages: [earlier, mocks.userMessage], assistant: { ...mocks.userMessage, role: "character", status: "streaming", content: "" } });
    vi.mocked(extractMemories).mockImplementation((input) => [{ ...mocks.memoryCandidate, sourceMessageId: input.turn.userMessage.id, candidateId: `candidate-${input.turn.userMessage.id}` }]);
    const response = await STREAM_POST(request({ pendingMessages: [{ clientMessageId: "earlier", text: earlier.content }] }), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(await response.text()).toContain('"type":"done"');
    expect(vi.mocked(extractMemories).mock.calls.map(([input]) => input.turn.userMessage)).toEqual([
      expect.objectContaining({ id: earlier.id, content: earlier.content }),
      expect.objectContaining({ id: mocks.userMessage.id, content: mocks.userMessage.content }),
    ]);
    expect(mocks.repository.finishReplyGeneration.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(extractMemories).mock.invocationCallOrder[0]);
    expect(mocks.commitMemories).toHaveBeenCalledTimes(1);
    expect(mocks.commitMemories).toHaveBeenCalledWith(expect.objectContaining({ candidates: [
      expect.objectContaining({ sourceMessageId: earlier.id }), expect.objectContaining({ sourceMessageId: mocks.userMessage.id }),
    ] }));
  });

  it("skips a batch memory source withdrawn after completion and keeps done when a memory source check fails", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    const earlier = { ...mocks.userMessage, id: "earlier-source", clientMessageId: "earlier", content: "Me gusta la fotografía." };
    mocks.repository.claimReplyGeneration.mockResolvedValueOnce({ status: "claimed", userMessages: [earlier, mocks.userMessage], assistant: { ...mocks.userMessage, role: "character", status: "streaming", content: "" } });
    mocks.repository.isMessageWithdrawn.mockImplementation(async (_userId, id) => id === earlier.id);
    const response = await STREAM_POST(request({ pendingMessages: [{ clientMessageId: "earlier", text: earlier.content }] }), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(await response.text()).toContain('"type":"done"');
    expect(vi.mocked(extractMemories).mock.calls.map(([input]) => input.turn.userMessage.id)).toEqual([mocks.userMessage.id]);
    mocks.repository.isMessageWithdrawn.mockReset().mockResolvedValueOnce(false).mockRejectedValue(new Error("memory source check unavailable"));
    const second = await STREAM_POST(request({ generationId: "second" }), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(await second.text()).toContain('"type":"done"');
    expect(mocks.commitMemories).toHaveBeenCalledTimes(1);
  });

  it("keeps a superseded prefix without done or memory after the next bubble loses ownership", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    process.env.MINIMAX_API_KEY = "test-key";
    mocks.provider.generate.mockResolvedValue({ text: "Estoy bien, gracias.\n\nHoy tengo un rato tranquilo.", provider: "minimax", modelVersion: "test-provider", providerRequestId: "provider-request-1", latencyMs: 1, estimatedCostMicros: null });
    mocks.repository.saveReplyPrefix.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await STREAM_POST(request(), { params: Promise.resolve({ characterId: "lucia" }) });
    const body = await response.text();
    expect(body).toContain("Estoy bien, gracias.");
    expect(body).not.toContain('"type":"done"');
    expect(body).not.toContain("Hoy tengo un rato tranquilo.");
    expect(mocks.repository.finishReplyGeneration).not.toHaveBeenCalled();
    expect(mocks.commitMemories).not.toHaveBeenCalled();
    expect(mocks.repository.cancelReplyGeneration).toHaveBeenCalled();
  });

  it("replays completed generations without another provider call or memory extraction", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.repository.claimReplyGeneration.mockResolvedValueOnce({ status: "completed", userMessages: [mocks.userMessage], assistant: { ...mocks.userMessage, role: "character", content: "Guardado.\n\nUna segunda idea." } });
    const response = await STREAM_POST(request(), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(await response.text()).toContain('"type":"done"');
    expect(mocks.provider.generate).not.toHaveBeenCalled();
    expect(mocks.commitMemories).not.toHaveBeenCalled();
    expect(mocks.repository.finishReplyGeneration).not.toHaveBeenCalled();
  });

  it("refuses duplicate in-flight generations before provider work", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.repository.claimReplyGeneration.mockResolvedValueOnce({ status: "in-progress", userMessages: [mocks.userMessage], assistant: mocks.userMessage });
    const response = await STREAM_POST(request(), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(409);
    expect(mocks.provider.generate).not.toHaveBeenCalled();
    expect(mocks.commitMemories).not.toHaveBeenCalled();
  });

  it("aborts the provider and cancels the durable generation when the response reader is cancelled", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    process.env.MINIMAX_API_KEY = "test-key";
    let providerSignal: AbortSignal | undefined;
    mocks.provider.generate.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      providerSignal = options?.signal;
      providerSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const response = await STREAM_POST(request(), { params: Promise.resolve({ characterId: "lucia" }) });
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    await reader.cancel();
    expect(providerSignal?.aborted).toBe(true);
    expect(mocks.repository.cancelReplyGeneration).toHaveBeenCalledWith(expect.objectContaining({ generationId: "generation-1" }));
    expect(mocks.repository.finishReplyGeneration).not.toHaveBeenCalled();
    expect(mocks.commitMemories).not.toHaveBeenCalled();
  });

  it("does not send done or memory when final persistence loses ownership", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.repository.finishReplyGeneration.mockResolvedValueOnce(null);
    const response = await STREAM_POST(request(), { params: Promise.resolve({ characterId: "lucia" }) });
    const body = await response.text();
    expect(body).not.toContain('"type":"done"');
    expect(body).toContain('"code":"stream-aborted"');
    expect(mocks.commitMemories).not.toHaveBeenCalled();
  });

  it("persists declared translation assistance without changing the sent text", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    const response = await STREAM_POST(new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterVersion: conversationCharacterVersion("lucia"), text: "Hola", clientMessageId: "assisted-client", generationId: "assisted-generation", assistance: "translation" }),
    }), { params: Promise.resolve({ characterId: "lucia" }) });
    await response.text();
    expect(mocks.repository.appendUserMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "Hola", sourceType: "translation_assisted" }));
  });

  it.each([true, "independent", null, {}])("rejects invalid assistance declarations", async (assistance) => {
    mocks.repository.appendUserMessage.mockClear();
    const response = await STREAM_POST(new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterVersion: conversationCharacterVersion("lucia"), text: "Hola", clientMessageId: "invalid-assist", generationId: "invalid-assist", assistance }),
    }), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(400); expect(mocks.repository.appendUserMessage).not.toHaveBeenCalled();
  });

  it("associates the assistant with the persisted user UUID before sending done", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characterVersion: conversationCharacterVersion("lucia") ?? 1,
        text: "Hola",
        clientMessageId: "client-1",
        generationId: "generation-1",
      }),
    });

    const response = await STREAM_POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    const body = await response.text();
    expect(body).toContain('"type":"done"');
    expect(mocks.repository.completeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      replyToMessageId: mocks.userMessage.id,
    }));
    expect(mocks.repository.completeAssistantMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      replyToMessageId: "client-1",
    }));
    expect(mocks.commitMemories).toHaveBeenCalledWith(expect.objectContaining({
      repository: mocks.memoryRepository,
      completed: true,
      candidates: [mocks.memoryCandidate],
    }));
  });

  it("passes the active Lucia relationship state into ordinary provider context", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    process.env.MINIMAX_API_KEY = "test-key";
    mocks.repository.listMessages.mockResolvedValue([]);
    const request = new NextRequest("http://localhost/api/v1/conversations/lucia/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterVersion: conversationCharacterVersion("lucia") ?? 1, text: "Hola", clientMessageId: "client-context", generationId: "generation-context" }),
    });

    const response = await STREAM_POST(request, { params: Promise.resolve({ characterId: "lucia" }) });
    await response.text();
    expect(mocks.provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      relationshipStage: "familiar",
      relationshipSummary: "Hablamos de fotografía.",
      openTopics: [],
    }), expect.anything());
  });

  it("exposes auth and database timings without message content", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.repository.listMessages.mockResolvedValue([]);
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations/lucia"), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({
      apiVersion: "v1",
      data: {
        readOnly: false,
        canSend: true,
        contactStatus: "active",
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(/^auth;dur=\d+, database;dur=\d+, total;dur=\d+$/);
    expect(response.headers.get("server-timing")).not.toContain("Hola");
  });

  it("returns a read-only history projection while a Lucía contact is pending", async () => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.repository.listMessages.mockResolvedValue([]);
    mocks.getLuciaContact.mockResolvedValue({ status: "pending", relationshipStage: "new_contact", relationshipSummary: null });
    const response = await GET(new NextRequest("http://localhost/api/v1/conversations/lucia"), { params: Promise.resolve({ characterId: "lucia" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { readOnly: true, canSend: false, contactStatus: "pending" },
    });
    mocks.getLuciaContact.mockResolvedValue({ status: "active", relationshipStage: "familiar", relationshipSummary: "Hablamos de fotografía." });
  });
});
