// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";
import { ConversationAssistantProviderError } from "@/src/modules/providers/assistant/assistant";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(() => ({})),
  repository: { getCurrentPublishedVersion: vi.fn(), listContext: vi.fn() },
  getContact: vi.fn(),
  assist: vi.fn(),
  record: vi.fn(),
}));
vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verifyRequestUser, getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/providers/assistant/server", () => ({ createMiniMaxConversationAssistantProvider: () => ({ assist: mocks.assist }) }));
vi.mock("@/src/modules/conversation/repositories/conversation-assistant-repository", () => ({ createDrizzleConversationAssistantRepository: () => mocks.repository }));
vi.mock("@/src/modules/character-network", () => ({ createDrizzleLuciaContactRepository: () => ({ get: mocks.getContact }), createDrizzleIntroductionRepository: vi.fn() }));
vi.mock("@/src/modules/providers/repositories/drizzle-provider-call-repository", () => ({ createDrizzleProviderCallRepository: () => ({ record: mocks.record }) }));
import { POST } from "@/app/api/v1/conversations/[characterId]/assistant/route";

const version = conversationCharacterVersion("lucia")!;
const command = { intent: "reply", characterVersion: version, attemptId: "attempt-private", question: "想拒绝她的邀请，怎么回？" };
const routeContext = { params: Promise.resolve({ characterId: "lucia" }) };
const created = {
  answer: "可以委婉拒绝，同时保持友好。",
  suggestions: [{ spanish: "Me encantaría, pero el sábado ya tengo planes.", chinese: "我很想去，但周六已经有安排了。" }],
  corrections: [],
  structure: [],
  correctedSentence: null,
};
const providerResult = { ...created, provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null };

function request(body: unknown = command, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/v1/conversations/lucia/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

function rawRequest(body: string) {
  return new NextRequest("http://localhost/api/v1/conversations/lucia/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://fake.invalid/test");
  mocks.verifyRequestUser.mockResolvedValue(null);
  mocks.getCurrentUser.mockResolvedValue({ id: "owner" });
  mocks.repository.getCurrentPublishedVersion.mockResolvedValue(version);
  mocks.repository.listContext.mockResolvedValue([{ role: "assistant", text: "¿Te vienes a cenar el sábado?" }]);
  mocks.getContact.mockResolvedValue({ status: "active" });
  mocks.assist.mockResolvedValue(providerResult);
  mocks.record.mockResolvedValue(undefined);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("conversation assistant HTTP boundary", () => {
  it("returns only the transient answer with private no-store and no real fetch", async () => {
    const response = await POST(request(), routeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      data: { attemptId: command.attemptId, intent: "reply", ...created },
    });
    expect(mocks.repository.listContext).toHaveBeenCalledWith("owner", "lucia");
    expect(mocks.assist.mock.calls[0]?.[0]).toEqual({
      intent: "reply",
      question: command.question,
      targetText: null,
      senseGroups: [],
      characterDisplayName: "Lucía Martín",
      recentMessages: [{ role: "assistant", text: "¿Te vienes a cenar el sábado?" }],
    });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      providerType: "assistant",
      provider: "fake",
      modelVersion: "fake-v1",
      status: "succeeded",
      correlation: { requestId: expect.any(String), attemptId: command.attemptId },
    }));
    const recorded = JSON.stringify(mocks.record.mock.calls);
    expect(recorded).not.toContain(command.question);
    expect(recorded).not.toContain("Me encantaría");
    expect(recorded).not.toContain(created.answer);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an invalid bearer instead of using the valid cookie", async () => {
    const response = await POST(request(command, { authorization: "Bearer invalid", cookie: "valid-cookie=true" }), routeContext);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it.each([
    { ...command, intent: "translate" },
    { ...command, intent: "question", question: undefined },
    { ...command, intent: "grammar", targetText: undefined },
    { ...command, intent: "grammar", targetText: " " },
    { ...command, characterVersion: 0 },
    { ...command, attemptId: "x".repeat(129) },
    { ...command, question: "x".repeat(801) },
    { ...command, targetText: "x".repeat(2_001) },
    { ...command, userId: "another-user" },
    { ...command, autoSend: true },
  ])("rejects invalid or extra input (case %#)", async (body) => {
    const response = await POST(request(body), routeContext);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and bounds announced request bodies", async () => {
    expect((await POST(rawRequest("{"), routeContext)).status).toBe(400);
    expect((await POST(request(command, { "content-length": "40000" }), routeContext)).status).toBe(400);
    expect((await POST(request({ ...command, question: "x".repeat(40_000) }), routeContext)).status).toBe(400);
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it("rejects stale, missing or unpublished current versions", async () => {
    expect((await POST(request({ ...command, characterVersion: version + 1 }), routeContext)).status).toBe(404);
    mocks.repository.getCurrentPublishedVersion.mockResolvedValue(null);
    expect((await POST(request(), routeContext)).status).toBe(404);
    const unknown = await POST(request(), { params: Promise.resolve({ characterId: "unknown" }) });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("CHARACTER_UNAVAILABLE");
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it.each(["pending", "declined"])("blocks %s contacts", async (status) => {
    mocks.getContact.mockResolvedValue({ status });
    const response = await POST(request(), routeContext);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CONTACT_REQUIRED");
    expect(mocks.repository.listContext).not.toHaveBeenCalled();
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it("maps contact and context failures to recoverable errors without leaking details", async () => {
    mocks.getContact.mockRejectedValueOnce(new Error("private contact failure"));
    const contact = await POST(request(), routeContext);
    expect(contact.status).toBe(503);
    const contactBody = await contact.json();
    expect(contactBody.error.code).toBe("CONTACT_UNAVAILABLE");
    expect(JSON.stringify(contactBody)).not.toContain("private contact failure");

    mocks.repository.listContext.mockRejectedValueOnce(new Error("private database failure"));
    const context = await POST(request(), routeContext);
    expect(context.status).toBe(503);
    expect((await context.json()).error.code).toBe("CONVERSATION_UNAVAILABLE");
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it("reports a missing analysis target with a specific Chinese message", async () => {
    mocks.repository.listContext.mockResolvedValue([{ role: "user", text: "Hola" }]);
    const response = await POST(request({ intent: "structure", characterVersion: version, attemptId: "attempt-structure" }), routeContext);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain("当前没有可分析的西语句子");
    expect(mocks.assist).not.toHaveBeenCalled();
  });

  it.each([
    ["provider-timeout", 504, "PROVIDER_TIMEOUT"],
    ["provider-rate-limited", 429, "RATE_LIMITED"],
    ["provider-response-invalid", 503, "PROVIDER_UNAVAILABLE"],
    ["provider-auth-failed", 503, "PROVIDER_UNAVAILABLE"],
    ["provider-unavailable", 503, "PROVIDER_UNAVAILABLE"],
    ["provider-cancelled", 499, "PROVIDER_UNAVAILABLE"],
  ] as const)("maps %s to HTTP %s without exposing private provider errors", async (code, status, apiCode) => {
    mocks.assist.mockRejectedValueOnce(new ConversationAssistantProviderError(code, "private provider body", false));
    const response = await POST(request(), routeContext);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.error.code).toBe(apiCode);
    expect(JSON.stringify(body)).not.toContain("private provider body");
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ providerType: "assistant", status: "failed", errorType: code }));
  });

  it("records a cancelled provider call and ignores observer failures", async () => {
    mocks.record.mockRejectedValueOnce(new Error("observer unavailable"));
    expect((await POST(request(), routeContext)).status).toBe(200);

    const controller = new AbortController();
    controller.abort();
    const cancelled = await POST(request(command, {}, controller.signal), routeContext);
    expect(cancelled.status).toBe(499);
    expect((await cancelled.json()).error.message).toContain("已取消");
  });

  it("allows an empty static context only through the explicit non-production fallback", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await POST(request(), routeContext)).status).toBe(200);
    expect(mocks.repository.listContext).not.toHaveBeenCalled();
    expect(mocks.assist.mock.calls[0]?.[0].recentMessages).toEqual([]);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVERSATION_ALLOW_FAKE", "1");
    mocks.assist.mockClear();
    expect((await POST(request(), routeContext)).status).toBe(503);
    expect(mocks.assist).not.toHaveBeenCalled();
  });
});
