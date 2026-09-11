// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));

import { handleGeneratePersonalScenario } from "@/app/api/v1/scenarios/generate/route";
import { FakeScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation";
import type { ScenarioLibraryRepository } from "@/src/modules/scenario-practice";

function repository(): ScenarioLibraryRepository {
  return {
    listSavedExpressions: vi.fn(async () => []), resolveSavedExpressionSource: vi.fn(async () => null), findSavedExpressionByClientSaveId: vi.fn(async () => null), createSavedExpression: vi.fn(async () => { throw new Error("unused"); }), archiveSavedExpression: vi.fn(async () => false),
    listGenerationSources: vi.fn(async () => ({ savedExpressions: [], readingHighlights: [], recentErrors: [] })),
    resolveGenerationSource: vi.fn(async () => ({ sourceType: "topic" as const, sourceEntityId: null, topic: "在药店询问用法", expressions: [], sourceVersion: null })),
    findPersonalScenarioByIdempotencyKey: vi.fn(async () => null),
    createPersonalScenario: vi.fn(async (input) => ({ ...input, createdAt: "2026-09-11T00:00:00.000Z" })),
    getPersonalScenario: vi.fn(async () => null), archivePersonalScenario: vi.fn(async () => false), listPersonalSuggestionCandidates: vi.fn(async () => []),
  };
}

describe("personal scenario generation route", () => {
  beforeEach(() => { mocks.verifyRequestUser.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000931" }); mocks.getCurrentUser.mockResolvedValue(null); });

  it("requires an idempotency key before any provider call", async () => {
    const provider = new FakeScenarioGenerationProvider();
    const response = await handleGeneratePersonalScenario(new NextRequest("http://localhost/api/v1/scenarios/generate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { repository: repository(), provider });
    expect(response.status).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it("returns an owned private route after explicit generation confirmation", async () => {
    const provider = new FakeScenarioGenerationProvider();
    const response = await handleGeneratePersonalScenario(new NextRequest("http://localhost/api/v1/scenarios/generate", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "generate-topic-1" },
      body: JSON.stringify({ requestId: "request-topic-1", generationId: "generation-topic-1", cefr: "A2", locale: "es-ES", source: { sourceType: "topic", topic: "在药店询问用法" } }),
    }), { repository: repository(), provider });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ data: { sourceType: "topic", route: expect.stringMatching(/^\/explore\/scenarios\/personal\./u) } });
    expect(provider.calls).toHaveLength(1);
  });
});
