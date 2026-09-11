import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

import { handleScenarioSuggestion } from "@/app/api/v1/explore/scenario-suggestions/route";
import type { ScenarioSuggestionCandidate } from "@/src/modules/explore/domain/scenario-suggestion";

const published: ScenarioSuggestionCandidate = {
  stableKey: "scenario.campus-help",
  title: "校园办事",
  description: "在校园服务台说明需要。",
  cefr: "A2",
  category: "study",
  categoryLabel: "学习办事",
  role: "校园工作人员",
  communicationGoal: "说明自己的需求",
  goalKeys: ["communication.need.ask-help"],
  expressionTexts: ["Necesito ayuda con este trámite."],
  modalities: ["speech", "typing"],
  sourceKind: "public",
  status: "published",
  route: "/explore/scenarios/scenario.campus-help",
};

describe("scenario suggestion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
  });

  it("requires authentication", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const response = await handleScenarioSuggestion(new NextRequest("http://localhost/api/v1/explore/scenario-suggestions", {
      method: "POST",
      body: JSON.stringify({ mode: "best_fit", suggestionSessionId: "session-1234", requestId: "request-1234", excludedScenarioIds: [] }),
      headers: { "content-type": "application/json" },
    }), {
      candidateRepository: { async listForUser() { return [published]; } },
      contextRepository: { async getForUser() { throw new Error("must not run"); } },
      random: () => 0,
      canGeneratePersonalScenario: false,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });

  it("rejects invalid input without invoking repositories", async () => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "user-1" });
    const listForUser = vi.fn();
    const response = await handleScenarioSuggestion(new NextRequest("http://localhost/api/v1/explore/scenario-suggestions", {
      method: "POST",
      body: JSON.stringify({ mode: "anything", suggestionSessionId: "x", requestId: "x", excludedScenarioIds: [] }),
      headers: { "content-type": "application/json" },
    }), {
      candidateRepository: { listForUser },
      contextRepository: { async getForUser() { throw new Error("must not run"); } },
      random: () => 0,
      canGeneratePersonalScenario: false,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(listForUser).not.toHaveBeenCalled();
  });

  it("returns a private, explainable suggestion", async () => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "user-1" });
    const response = await handleScenarioSuggestion(new NextRequest("http://localhost/api/v1/explore/scenario-suggestions", {
      method: "POST",
      body: JSON.stringify({ mode: "best_fit", suggestionSessionId: "session-1234", requestId: "request-1234", excludedScenarioIds: [] }),
      headers: { "content-type": "application/json", "x-request-id": "transport-1234" },
    }), {
      candidateRepository: { async listForUser(userId) { expect(userId).toBe("user-1"); return [published]; } },
      contextRepository: { async getForUser(userId) { expect(userId).toBe("user-1"); return { cefr: "A2", savedExpressionTexts: [], reliableGapGoalKeys: [], practicedScenarioKeys: [], practicedCategories: [], practicedGoalKeys: [], recentScenarioKeys: [], activeScenarioKeys: [] }; } },
      random: () => 0,
      canGeneratePersonalScenario: false,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      data: {
        requestId: "request-1234",
        suggestionSessionId: "session-1234",
        scenario: { stableKey: "scenario.campus-help" },
        reasons: [{ code: "level-match" }],
      },
    });
  });
});
