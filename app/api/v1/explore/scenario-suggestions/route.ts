import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  suggestScenarioForUser,
  type ScenarioSuggestionCandidateRepository,
  type ScenarioSuggestionContextRepository,
} from "@/src/modules/explore/application/suggest-scenario";
import {
  CatalogScenarioSuggestionRepository,
  createDrizzleScenarioSuggestionContextRepository,
  emptyScenarioSuggestionContextRepository,
} from "@/src/modules/explore/repositories";
import { scenarioSuggestionRequestSchema } from "@/src/modules/explore/schemas";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type ScenarioSuggestionRouteDependencies = Readonly<{
  candidateRepository: ScenarioSuggestionCandidateRepository;
  contextRepository: ScenarioSuggestionContextRepository;
  random: () => number;
  canGeneratePersonalScenario: boolean;
}>;

function createDefaultDependencies(): ScenarioSuggestionRouteDependencies {
  const databaseAvailable = Boolean(process.env.DATABASE_URL);
  return {
    candidateRepository: new CatalogScenarioSuggestionRepository(),
    contextRepository: databaseAvailable
      ? createDrizzleScenarioSuggestionContextRepository(getDatabase())
      : emptyScenarioSuggestionContextRepository,
    random: Math.random,
    canGeneratePersonalScenario: databaseAvailable && Boolean(process.env.MINIMAX_API_KEY),
  };
}

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string, retryable = false) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable } },
    { status, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
  );
}

export async function handleScenarioSuggestion(
  request: NextRequest,
  dependencies: ScenarioSuggestionRouteDependencies = createDefaultDependencies(),
) {
  const transportRequestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse(transportRequestId, "AUTH_REQUIRED", 401, "需要有效的用户会话。");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(transportRequestId, "VALIDATION_FAILED", 400, "请求内容不是有效的 JSON。");
  }
  const parsed = scenarioSuggestionRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(transportRequestId, "VALIDATION_FAILED", 400, "场景选择参数无效。");

  try {
    const result = await suggestScenarioForUser(
      dependencies.candidateRepository,
      dependencies.contextRepository,
      {
        userId: user.id,
        mode: parsed.data.mode,
        excludedScenarioIds: parsed.data.excludedScenarioIds,
        ...(parsed.data.category ? { category: parsed.data.category } : {}),
        ...(parsed.data.cefr ? { cefr: parsed.data.cefr } : {}),
        ...(parsed.data.modality ? { modality: parsed.data.modality } : {}),
      },
      dependencies.random,
    );
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          requestId: parsed.data.requestId,
          suggestionSessionId: parsed.data.suggestionSessionId,
          scenario: result.scenario ? {
            stableKey: result.scenario.stableKey,
            title: result.scenario.title,
            description: result.scenario.description,
            cefr: result.scenario.cefr,
            category: result.scenario.category,
            categoryLabel: result.scenario.categoryLabel,
            role: result.scenario.role,
            communicationGoal: result.scenario.communicationGoal,
            sourceKind: result.scenario.sourceKind,
            route: result.scenario.route!,
          } : null,
          reasons: result.reasons,
          eligibleCount: result.eligibleCount,
          canSwap: result.canSwap,
          limitReached: result.limitReached,
          fallback: result.scenario ? null : {
            canGeneratePersonalScenario: dependencies.canGeneratePersonalScenario,
            topicChips: ["日常生活", "学习办事", "社交沟通"],
          },
        },
      },
      { headers: { "cache-control": "private, no-store", "x-request-id": transportRequestId } },
    );
  } catch {
    return errorResponse(transportRequestId, "SCENARIO_SUGGESTION_UNAVAILABLE", 503, "暂时无法选择场景，可以重试或直接搜索。", true);
  }
}

export async function POST(request: NextRequest) {
  return handleScenarioSuggestion(request);
}
