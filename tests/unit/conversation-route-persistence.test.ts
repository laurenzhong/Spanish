import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      getOrCreateConversation: vi.fn().mockResolvedValue("20000000-0000-4000-8000-000000000042"),
      appendUserMessage: vi.fn().mockResolvedValue(userMessage),
      completeAssistantMessage: vi.fn().mockResolvedValue({ ...userMessage, id: "30000000-0000-4000-8000-000000000043", role: "character", content: "reply" }),
      findAssistantMessage: vi.fn(),
      listMessages: vi.fn(),
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
      category: "interest",
      content: "la fotografía",
      confidence: 0.9,
      sensitivity: "normal",
      shareScope: "private",
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

describe("conversation stream persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.MINIMAX_API_KEY;
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
