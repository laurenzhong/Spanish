import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxScenarioEvaluationProvider, OpenAIScenarioEvaluationProvider } from "@/src/modules/providers/scenario-evaluation/server";

describe("MiniMax scenario evaluation contract", () => {
  it("accepts contextual success and bounded error spans", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ contextualSuccess: true, errors: [{ turnId: "turn-1", start: 0, end: 8, category: "register", explanation: "可以更委婉，但意思清楚。", affectsUnderstanding: false, naturalAlternative: "Quería pedir..." }] }) }] }), { status: 200, headers: { "x-request-id": "provider-request-1" } }));
    const provider = new MiniMaxScenarioEvaluationProvider({ apiKey: "test-key", fetchImplementation, clock: () => 10 });
    const result = await provider.evaluate({ requestId: "request-1", sessionId: "session-1", generationId: "generation-1", communicationGoal: "完成点单", modality: "typing", hintLevel: 0, transcriptConfidence: null, completedTurns: [{ turnId: "turn-1", speaker: "user", text: "Quiero sopa." }] });
    expect(result).toMatchObject({ contextualSuccess: true, provider: "minimax", providerRequestId: "provider-request-1" });
    expect(result.errors[0]).toMatchObject({ affectsUnderstanding: false, naturalAlternative: "Quería pedir..." });
  });

  it("rejects spans that do not belong to a completed user turn", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ contextualSuccess: false, errors: [{ turnId: "unknown", start: 0, end: 4, category: "grammar", explanation: "错误。", affectsUnderstanding: true, naturalAlternative: null }] }) }] }), { status: 200 }));
    const provider = new MiniMaxScenarioEvaluationProvider({ apiKey: "test-key", fetchImplementation });
    await expect(provider.evaluate({ requestId: "request-1", sessionId: "session-1", generationId: "generation-1", communicationGoal: "办事", modality: "speech", hintLevel: 1, transcriptConfidence: .8, completedTurns: [{ turnId: "turn-1", speaker: "user", text: "Hola" }] })).rejects.toMatchObject({ code: "provider-response-invalid" });
  });

  it("validates OpenAI evaluation with the same contextual-success semantics", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify({ contextualSuccess: true, errors: [] }) }), { status: 200, headers: { "x-request-id": "openai-eval-1" } }));
    const provider = new OpenAIScenarioEvaluationProvider({ apiKey: "test-key", fetchImplementation, clock: () => 30 });
    const result = await provider.evaluate({ requestId: "request-2", sessionId: "session-1", generationId: "generation-2", communicationGoal: "办事", modality: "typing", hintLevel: 0, transcriptConfidence: null, completedTurns: [{ turnId: "turn-1", speaker: "user", text: "Necesito ayuda." }] });
    expect(result).toMatchObject({ contextualSuccess: true, provider: "openai", providerRequestId: "openai-eval-1" });
  });
});
