// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";
import { TranslationError } from "@/src/modules/providers/translation/translation";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(), getCurrentUser: vi.fn(), getDatabase: vi.fn(() => ({})),
  repository: { getCurrentPublishedVersion: vi.fn(), listContext: vi.fn() },
  getContact: vi.fn(), translate: vi.fn(), record: vi.fn(), runAttempt: vi.fn(),
}));
vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verifyRequestUser, getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/providers/translation/server", () => ({ createMiniMaxTranslationProvider: () => ({ translate: mocks.translate }) }));
vi.mock("@/src/modules/conversation/repositories/expression-assist-repository", () => ({ createDrizzleExpressionAssistRepository: () => mocks.repository }));
vi.mock("@/src/modules/character-network", () => ({ createDrizzleLuciaContactRepository: () => ({ get: mocks.getContact }), createDrizzleIntroductionRepository: vi.fn() }));
vi.mock("@/src/modules/providers/repositories/drizzle-provider-call-repository", () => ({ createDrizzleProviderCallRepository: () => ({ record: mocks.record }) }));
vi.mock("@/src/modules/conversation/application/expression-assist-attempts", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/modules/conversation/application/expression-assist-attempts")>(), expressionAssistAttempts: { run: mocks.runAttempt },
}));
import { ExpressionAssistAttempts } from "@/src/modules/conversation/application/expression-assist-attempts";
import { POST } from "@/app/api/v1/conversations/[characterId]/expression-assist/route";

const version = conversationCharacterVersion("lucia")!;
const command = { text: "我今天有点累", characterVersion: version, attemptId: "attempt-private" };
const context = { params: Promise.resolve({ characterId: "lucia" }) };
const result = { text: "Hoy estoy un poco cansado.", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null };
function request(body: unknown = command, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/v1/conversations/lucia/expression-assist", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://fake.invalid/test");
  mocks.verifyRequestUser.mockResolvedValue(null); mocks.getCurrentUser.mockResolvedValue({ id: "owner" });
  mocks.repository.getCurrentPublishedVersion.mockResolvedValue(version); mocks.repository.listContext.mockResolvedValue([{ role: "user", text: "¿Vamos al cine?" }]);
  mocks.getContact.mockResolvedValue({ status: "active" }); mocks.translate.mockResolvedValue(result); mocks.record.mockResolvedValue(undefined);
  const attempts = new ExpressionAssistAttempts(); mocks.runAttempt.mockImplementation(attempts.run.bind(attempts));
});
afterEach(() => vi.unstubAllEnvs());
describe("expression assistance HTTP boundary", () => {
  it("returns only text and attempt ID with private no-store", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ apiVersion: "v1", data: { text: result.text, attemptId: command.attemptId } });
    expect(mocks.repository.listContext).toHaveBeenCalledWith("owner", "lucia");
    expect(mocks.translate.mock.calls[0][0]).toEqual({ text: command.text, sourceLocale: "zh-CN", targetLocale: "es-ES", context: [{ role: "user", text: "¿Vamos al cine?" }] });
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain(command.text);
  });
  it("refuses invalid bearer instead of using the valid cookie", async () => {
    const response = await POST(request(command, { authorization: "Bearer invalid", cookie: "valid-cookie=true" }), context);
    expect(response.status).toBe(401); expect(mocks.getCurrentUser).not.toHaveBeenCalled(); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("revalidates access on a reused attempt and refuses a different draft for the same attempt", async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.translate).toHaveBeenCalledTimes(1); expect(mocks.getContact).toHaveBeenCalledTimes(2);
    expect((await POST(request({ ...command, text: "different draft" }), context)).status).toBe(409);
    mocks.getContact.mockResolvedValueOnce({ status: "declined" });
    expect((await POST(request(), context)).status).toBe(403); expect(mocks.translate).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...command, text: "" }, { ...command, text: "x".repeat(2001) }, { ...command, characterVersion: 0 }, { ...command, attemptId: "x".repeat(129) }, { ...command, context: [{ text: "client-controlled" }] }, { ...command, autoSend: true }])("rejects invalid or extra input", async (body) => {
    const response = await POST(request(body), context);
    expect(response.status).toBe(400); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("bounds announced and chunked request bodies before parsing", async () => {
    expect((await POST(request(command, { "content-length": "20000" }), context)).status).toBe(400);
    expect((await POST(request({ ...command, text: "x".repeat(20000) }), context)).status).toBe(400);
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("rejects stale, missing, or unpublished current versions", async () => {
    expect((await POST(request({ ...command, characterVersion: version - 1 }), context)).status).toBe(404);
    mocks.repository.getCurrentPublishedVersion.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(404); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it.each(["pending", "declined"])("blocks %s contacts", async (status) => {
    mocks.getContact.mockResolvedValue({ status });
    expect((await POST(request(), context)).status).toBe(403); expect(mocks.repository.listContext).not.toHaveBeenCalled(); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("fails closed on history access failure", async () => {
    mocks.repository.listContext.mockRejectedValueOnce(new Error("private database failure"));
    const response = await POST(request(), context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private database failure"); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("requires persistence in production, even with a fake flag", async () => {
    vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CONVERSATION_ALLOW_FAKE", "1");
    const response = await POST(request(), context);
    expect(response.status).toBe(503); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it("allows an empty context only through the explicit nonproduction fallback gate", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.translate.mock.calls[0][0].context).toEqual([]);
  });
  it.each([["provider-timeout", 504, "PROVIDER_TIMEOUT"], ["provider-rate-limited", 429, "RATE_LIMITED"], ["provider-response-invalid", 503, "PROVIDER_UNAVAILABLE"], ["provider-cancelled", 499, "PROVIDER_UNAVAILABLE"]] as const)("maps %s without exposing private errors", async (code, status, apiCode) => {
    mocks.translate.mockRejectedValueOnce(new TranslationError(code, "private provider body", false));
    const response = await POST(request(), context);
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(body.error.code).toBe(apiCode); expect(JSON.stringify(body)).not.toContain("private provider body");
  });
  it("rejects an invalid result and already cancelled requests", async () => {
    mocks.translate.mockResolvedValueOnce({ ...result, text: "中文" });
    expect((await POST(request(), context)).status).toBe(503);
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.translate).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort();
    expect((await POST(request(command, {}, controller.signal), context)).status).toBe(499);
  });
});
