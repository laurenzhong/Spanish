import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  verifyRequestUser: vi.fn(),
  roleplayStream: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/modules/providers/scenario-roleplay/server", () => ({ createMiniMaxScenarioRoleplayProvider: () => ({ key: "test-roleplay", stream: mocks.roleplayStream }) }));
vi.mock("@/src/modules/providers/scenario-evaluation/server", () => ({ createMiniMaxScenarioEvaluationProvider: () => ({ key: "test-evaluation", evaluate: mocks.evaluate }) }));

import { GET as getScenario } from "@/app/api/v1/scenarios/[scenarioId]/route";
import { POST as createSession } from "@/app/api/v1/scenario-practice/sessions/route";
import { POST as respond } from "@/app/api/v1/scenario-practice/sessions/[sessionId]/turns/[turnId]/respond/route";
import { POST as evaluate } from "@/app/api/v1/scenario-practice/sessions/[sessionId]/turns/[turnId]/evaluate/route";

const sessionId = "10000000-0000-4000-8000-000000000001";
const userTurnId = "20000000-0000-4000-8000-000000000001";

describe("scenario routes", () => {
  beforeEach(() => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" });
    mocks.getCurrentUser.mockResolvedValue(null);
    delete process.env.DATABASE_URL;
  });
  afterEach(() => vi.clearAllMocks());

  it("returns content-driven scenario detail", async () => {
    const response = await getScenario(new Request("http://localhost/api/v1/scenarios/scenario.campus-administration"), { params: Promise.resolve({ scenarioId: "scenario.campus-administration" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", data: { stableKey: "scenario.campus-administration", temporaryCharacter: { displayName: "Javier" } } });
  });

  it("declares device persistence when the account database is not configured", async () => {
    const request = new NextRequest("http://localhost/api/v1/scenario-practice/sessions", { method: "POST", body: JSON.stringify({ sessionId, clientAttemptId: "attempt-1", scenarioKey: "scenario.restaurant-ordering", primaryModality: "typing" }), headers: { "content-type": "application/json" } });
    const response = await createSession(request);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", data: { sessionId, persistence: "device" } });
  });

  it("emits a content condition once before a complete character reply", async () => {
    mocks.roleplayStream.mockImplementation(async function* () { yield { type: "delta", generationId: "generation-1", text: "Lo siento, se ha terminado." }; yield { type: "done", generationId: "generation-1" }; });
    const request = new NextRequest(`http://localhost/api/v1/scenario-practice/sessions/${sessionId}/turns/${userTurnId}/respond`, { method: "POST", body: JSON.stringify({ scenarioKey: "scenario.restaurant-ordering", generationId: "generation-1", characterTurnId: "30000000-0000-4000-8000-000000000001", turnIndex: 3, persist: false, completedTurns: [{ speaker: "user", text: "Quería pedir sopa." }, { speaker: "temporary-character", text: "Claro." }, { speaker: "user", text: "¿Lleva frutos secos?" }], triggeredConditions: [] }), headers: { "content-type": "application/json" } });
    const response = await respond(request, { params: Promise.resolve({ sessionId, turnId: userTurnId }) });
    const frames = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    expect(frames.map((frame) => frame.type)).toEqual(["meta", "condition", "delta", "done"]);
  });

  it("keeps a low-confidence speech transcript neutral without calling evaluation", async () => {
    const request = new NextRequest(`http://localhost/api/v1/scenario-practice/sessions/${sessionId}/turns/${userTurnId}/evaluate`, { method: "POST", body: JSON.stringify({ scenarioKey: "scenario.campus-administration", generationId: "generation-1", persist: false, modality: "speech", hintLevel: 0, transcriptConfidence: .35, completedTurns: [{ turnId: userTurnId, speaker: "user", text: "Necesito ayuda." }] }), headers: { "content-type": "application/json" } });
    const response = await evaluate(request, { params: Promise.resolve({ sessionId, turnId: userTurnId }) });
    expect(response.status).toBe(202);
    expect(response.headers.get("x-review-reason")).toBe("low-confidence-transcript");
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});
