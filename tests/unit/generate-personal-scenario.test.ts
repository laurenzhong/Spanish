import { describe, expect, it, vi } from "vitest";

import { generatePersonalScenario, PersonalScenarioConflictError, PersonalScenarioSourceError, type ScenarioLibraryRepository } from "@/src/modules/scenario-practice";
import { FakeScenarioGenerationProvider, ScenarioProviderError } from "@/src/modules/providers/scenario-generation";

const source = {
  sourceType: "saved-expression" as const,
  sourceEntityId: "saved-1",
  topic: "在咖啡馆礼貌提出请求",
  expressions: [{ text: "Quisiera un café, por favor.", translation: "我想要一杯咖啡。" }],
  sourceVersion: "1",
};

function repository(): ScenarioLibraryRepository {
  const personal = new Map<string, Awaited<ReturnType<ScenarioLibraryRepository["createPersonalScenario"]>>>();
  return {
    listSavedExpressions: vi.fn(async () => []),
    resolveSavedExpressionSource: vi.fn(async () => null),
    findSavedExpressionByClientSaveId: vi.fn(async () => null),
    createSavedExpression: vi.fn(async () => { throw new Error("unused"); }),
    archiveSavedExpression: vi.fn(async () => false),
    listGenerationSources: vi.fn(async () => ({ savedExpressions: [], readingHighlights: [], recentErrors: [] })),
    resolveGenerationSource: vi.fn(async (_userId, input) => input.sourceType === "saved-expression" && input.sourceId === "saved-1" ? source : null),
    findPersonalScenarioByIdempotencyKey: vi.fn(async (_userId, key) => personal.get(key) ?? null),
    createPersonalScenario: vi.fn(async (input) => {
      const record = { ...input, id: "10000000-0000-4000-8000-000000000901", createdAt: "2026-09-11T00:00:00.000Z" };
      personal.set(input.idempotencyKey, record);
      return record;
    }),
    getPersonalScenario: vi.fn(async () => null),
    archivePersonalScenario: vi.fn(async () => false),
    listPersonalSuggestionCandidates: vi.fn(async () => []),
  };
}

describe("generatePersonalScenario", () => {
  it("verifies an owned source, validates provider output, and reuses an idempotent result", async () => {
    const repo = repository();
    const provider = new FakeScenarioGenerationProvider();
    const input = {
      userId: "00000000-0000-4000-8000-000000000901",
      idempotencyKey: "generate-cafe-1",
      requestId: "request-cafe-1",
      generationId: "generation-cafe-1",
      cefr: "A2" as const,
      locale: "es-ES" as const,
      source: { sourceType: "saved-expression" as const, sourceId: "saved-1" },
    };

    const first = await generatePersonalScenario(repo, provider, input, { makeId: () => "10000000-0000-4000-8000-000000000901" });
    const repeated = await generatePersonalScenario(repo, provider, input, { makeId: () => "different-id" });

    expect(first).toEqual(repeated);
    expect(first.detail).toMatchObject({
      stableKey: "personal.10000000-0000-4000-8000-000000000901",
      status: "draft",
      temporaryCharacter: { displayName: "Carmen" },
    });
    expect(first.detail.expressions[0]?.text).toBe("Quisiera un café, por favor.");
    expect(provider.calls).toHaveLength(1);
    expect(repo.createPersonalScenario).toHaveBeenCalledTimes(1);
  });

  it("rejects an unowned source before calling the provider", async () => {
    const repo = repository();
    const provider = new FakeScenarioGenerationProvider();
    await expect(generatePersonalScenario(repo, provider, {
      userId: "00000000-0000-4000-8000-000000000901",
      idempotencyKey: "generate-missing",
      requestId: "request-missing",
      generationId: "generation-missing",
      cefr: "A2",
      locale: "es-ES",
      source: { sourceType: "reading", sourceId: "other-user-highlight" },
    })).rejects.toBeInstanceOf(PersonalScenarioSourceError);
    expect(provider.calls).toHaveLength(0);
  });

  it("returns a conflict when the same key is reused with different input", async () => {
    const repo = repository();
    const provider = new FakeScenarioGenerationProvider();
    const base = {
      userId: "00000000-0000-4000-8000-000000000901",
      idempotencyKey: "generate-conflict",
      requestId: "request-conflict",
      generationId: "generation-conflict",
      cefr: "A2" as const,
      locale: "es-ES" as const,
      source: { sourceType: "topic" as const, topic: "在药店询问用药" },
    };
    vi.mocked(repo.resolveGenerationSource).mockResolvedValue({ sourceType: "topic", sourceEntityId: null, topic: "在药店询问用药", expressions: [], sourceVersion: null });
    await generatePersonalScenario(repo, provider, base);
    await expect(generatePersonalScenario(repo, provider, { ...base, cefr: "B1" })).rejects.toBeInstanceOf(PersonalScenarioConflictError);
    expect(provider.calls).toHaveLength(1);
  });

  it("does not persist a partial scenario when generation fails", async () => {
    const repo = repository();
    vi.mocked(repo.resolveGenerationSource).mockResolvedValue({ sourceType: "topic", sourceEntityId: null, topic: "在医院说明症状", expressions: [], sourceVersion: null });
    const provider = new FakeScenarioGenerationProvider(new ScenarioProviderError("provider-unavailable", "offline", true));
    await expect(generatePersonalScenario(repo, provider, {
      userId: "00000000-0000-4000-8000-000000000901", idempotencyKey: "generate-failure", requestId: "request-failure", generationId: "generation-failure", cefr: "A2", locale: "es-ES", source: { sourceType: "topic", topic: "在医院说明症状" },
    })).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(repo.createPersonalScenario).not.toHaveBeenCalled();
  });
});
