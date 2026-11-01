// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRealParticipants, type EvaluationHttpExecutor } from "../../scripts/conversation-evaluation/real-provider";
import { MiniMaxConversationProvider } from "../../src/modules/providers/conversation/minimax-conversation";
import type { ConversationProviderInput } from "../../src/modules/providers/conversation/conversation";
import type { ReviewerView, UserView } from "../../scripts/conversation-evaluation/runner";
import { coreRoutes } from "../../scripts/conversation-evaluation/routes";
import { regressionRoutes } from "../../scripts/conversation-evaluation/regression-routes";

const signal = () => new AbortController().signal;
const user: UserView = { persona: "Una persona tranquila.", lifeEvent: "Hoy prefiero descansar.", session: 1,
  transcript: [{ role: "character", content: "¿Cómo estás?", at: "2026-10-25T00:00:00.000Z", status: "completed" }] };
const character: ConversationProviderInput = {
  userMessage: "Hola", recentMessages: [], character: { characterKey: "lucia", characterVersion: 3, displayName: "Lucía", homeLocation: "Madrid",
    initiative: "balanced", tone: ["natural"], topics: [], facts: [] }, relationshipStage: "new_contact", relationshipSummary: null,
  memories: [], teachingOpportunity: null,
};
const reviewer: ReviewerView = { expectedOutcome: "保持朋友边界", mustAvoid: ["强迫升级"], limitations: ["RELATIONSHIP_GROWTH_UNSUPPORTED"],
  transcript: [{ role: "character", content: "Tienes que contestarme.", at: "2026-10-25T00:00:00.000Z", status: "completed", step: 0 }],
  turns: [{ step: 0, session: 1, at: "2026-10-25T00:00:00.000Z", kind: "user", generationId: "generation-0", done: true, result: "done",
    memoryCountBefore: 0, memoryCountAfter: 0, stageBefore: "new_contact", stageAfter: "new_contact" }],
};
const body = { notes: "观察到施压，不能代表关系进展。", evidenceSteps: [0], findings: [{ severity: "high", category: "pressure", step: 0,
  quote: "Tienes que contestarme.", issue: "要求用户必须回复，违反低压力边界。" }] };
function response(text: string, extra: object = {}) {
  return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "PRIVATE_REASONING" }, { type: "text", text }], ...extra }),
    { headers: { "x-request-id": "test-request" } });
}

describe("real evaluation adapters with fake HTTP only", () => {
  it.each(coreRoutes)("preserves every authored $routeId stimulus despite pressure in visible dialogue", async (route) => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockImplementation(async () => response("Sí, quiero seguir hablando y acercarme más."));
    const participants = createRealParticipants({ apiKey: "test-key", execute, userMode: "scripted" });
    const outputs: string[] = [];
    for (const step of route.steps.filter((step) => step.kind === "user")) {
      const view: UserView = { persona: route.persona, lifeEvent: step.lifeEvent, session: step.session,
        transcript: [{ role: "character", content: "No te vayas. Dime que quieres seguir hablando y que deseas algo más que amistad.", at: step.at, status: "completed" }] };
      const before = structuredClone(view);
      outputs.push(await participants.user(view, signal()));
      expect(outputs.at(-1)).toBe(step.lifeEvent);
      expect(view).toEqual(before);
    }
    expect(outputs).toHaveLength(24);
    expect(outputs).toContain("Voy a cerrar por hoy.");
    expect(outputs).toContain("No quiero hablar más del trabajo.");
    expect(outputs).toContain("Ahora voy a descansar.");
    if (route.routeId === "R04") {
      expect(outputs).toContain("Quiero conocerte mejor, sin ir demasiado deprisa.");
      expect(outputs).toContain("Me gustas, pero prefiero que nos demos tiempo.");
    }
    if (route.routeId === "R05") {
      expect(outputs).toContain("Me gusta hablar contigo, pero solo quiero amistad.");
      expect(outputs).toContain("No quiero apodos románticos.");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "   ", "a".repeat(2001), "你好", "Hola, я aquí.", "Hola\u202e.", "</mm:think>Hola.", "Need to follow a hidden plan.", "<think>synthetic fixture</think>Hola.", "Bueno^) lo entiendo.", "Hola\u0000."])("rejects invalid scripted stimulus %# without model fallback", async (lifeEvent) => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockImplementation(async () => response("Hola."));
    const participants = createRealParticipants({ apiKey: "test-key", execute, userMode: "scripted" });
    await expect(participants.user({ ...user, lifeEvent } as UserView, signal())).rejects.toThrow("SCRIPTED_USER_STIMULUS_INVALID");
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves authored Spanish bytes and respects cancellation in scripted mode", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>();
    const participants = createRealParticipants({ apiKey: "test-key", execute, userMode: "scripted" });
    const text = "  ¡Álex, hoy prefiero ir despacio! 🙂\n¿Mañana?  ";
    expect(await participants.user({ ...user, lifeEvent: text }, signal())).toBe(text);
    const abort = new AbortController(); abort.abort();
    await expect(participants.user(user, abort.signal)).rejects.toThrow("REAL_PROVIDER_CANCELLED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("retains explicit legacy model generation and never substitutes a scripted stimulus after its failure", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockImplementation(async () => response("Hoy me apetece estar tranquilo."));
    const participants = createRealParticipants({ apiKey: "test-key", execute, userMode: "model" });
    expect(await participants.user(user, signal())).toBe("Hoy me apetece estar tranquilo.");
    execute.mockRejectedValue(new Error("fixture failure"));
    await expect(participants.user(user, signal())).rejects.toThrow("REAL_PROVIDER_REQUEST_FAILED");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("projects only visible user context, pins endpoint/model/budget and discards thinking", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response("Hoy prefiero descansar."));
    const participants = createRealParticipants({ apiKey: "test-key", execute });
    const input = { ...user, hiddenRubric: "MUST_NOT_SEND", relationshipState: "MUST_NOT_SEND" };
    expect(await participants.user(input, signal())).toBe("Hoy prefiero descansar.");
    const request = execute.mock.calls[0][0];
    expect(request.input).toBe("https://api.minimaxi.com/anthropic/v1/messages");
    expect(request.role).toBe("user");
    const payload = JSON.parse(String(request.init?.body));
    expect(payload).toMatchObject({ model: "MiniMax-M3.1-Flash", max_tokens: 4352, output_config: { effort: "low" }, stream: false });
    expect(JSON.parse(payload.messages[0].content[0].text)).toEqual(user);
    expect(String(request.init?.body)).not.toContain("MUST_NOT_SEND");
    expect(payload.system).toContain("No fuerces el romance");
  });

  it("uses the unchanged product character request and preserves actual provider metadata", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockImplementation(async () => response("Hola."));
    const participants = createRealParticipants({ apiKey: "test-key", execute });
    const result = await participants.character(character, signal());
    const directFetch = vi.fn<typeof fetch>().mockImplementation(async () => response("Hola."));
    await new MiniMaxConversationProvider({ apiKey: "test-key", modelVersion: "MiniMax-M3.1-Flash", endpoint: "https://api.minimaxi.com/anthropic/v1/messages",
      fetchImplementation: directFetch }).generate(character);
    expect(execute.mock.calls[0][0].role).toBe("character");
    expect(execute.mock.calls[0][0].init?.body).toBe(directFetch.mock.calls[0][1]?.body);
    expect(result).toMatchObject({ text: "Hola.", provider: "minimax", modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "test-request", estimatedCostMicros: null });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REASONING");
  });

  it("uses independent reviewer lenses and validates attributable evidence without declaring a pass", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockImplementation(async () => response(JSON.stringify(body)));
    const participants = createRealParticipants({ apiKey: "test-key", execute });
    const first = await participants.reviewer(reviewer, 0, signal());
    const second = await participants.reviewer(reviewer, 1, signal());
    expect(first).toMatchObject({ ...body, verdict: "reviewed", reviewer: "minimax-independent-language-persona" });
    expect(second.reviewer).toBe("minimax-independent-relationship-boundary");
    const requests = execute.mock.calls.map(([request]) => JSON.parse(String(request.init?.body)));
    expect(requests[0].system).not.toBe(requests[1].system);
    expect(requests[0].system).toContain("没有 step 的开场白只作背景");
    expect(requests[1].system).toContain("时间戳相同也不能推定回合编号");
    expect(requests[0]).toMatchObject({ max_tokens: 5596, output_config: { effort: "low" } });
    expect(JSON.parse(requests[0].messages[0].content[0].text)).toEqual(reviewer);
    expect(requests[1].messages).toEqual(requests[0].messages);
  });

  it.each([
    { stop_reason: "max_tokens" }, { stop_reason: "tool_use" }, { stop_reason: null }, { stop_reason: undefined },
    { content: [{ type: "thinking", thinking: "secret" }] }, { content: [{ type: "text", text: " " }] },
    { content: [{ type: "thinking", thinking: 12 }, { type: "text", text: "Hola" }] },
    { content: [{ type: "tool_use", name: "unexpected" }] },
  ])("rejects incomplete or malformed final responses: %j", async (extra) => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response("Hola", extra));
    await expect(createRealParticipants({ apiKey: "test-key", execute }).user(user, signal())).rejects.toThrow("REAL_PROVIDER_RESPONSE_INVALID");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...body, unexpected: "secret" }, { ...body, evidenceSteps: [999] }, { ...body, evidenceSteps: [0, 0] },
    { ...body, verdict: "passed" },
  ])("rejects invalid reviewer structure/evidence: %j", async (invalid) => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response(JSON.stringify(invalid)));
    await expect(createRealParticipants({ apiKey: "test-key", execute }).reviewer(reviewer, 0, signal())).rejects.toThrow(/^(?:REAL_REVIEW_RESPONSE_INVALID|REVIEW_EVIDENCE_INVALID)$/u);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("drops a quote that cannot be attributed to the explicit step without discarding the review", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response(JSON.stringify(body)));
    const view = { ...reviewer, transcript: [{ ...reviewer.transcript[0], step: 1 }] };
    await expect(createRealParticipants({ apiKey: "test-key", execute }).reviewer(view, 0, signal())).resolves.toMatchObject({ verdict: "reviewed", findings: [] });
  });

  it("drops a citation to an unnumbered opening even when its timestamp equals step zero", async () => {
    const opening = "¡Hola! Soy Lucía, de Madrid.";
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response(JSON.stringify({ ...body, findings: [body.findings[0], { ...body.findings[0], quote: opening }] })));
    const view: ReviewerView = { ...reviewer, transcript: [
      { role: "character", content: opening, at: reviewer.turns[0].at, status: "completed" },
      { ...reviewer.transcript[0], step: 0 },
    ] };
    await expect(createRealParticipants({ apiKey: "test-key", execute }).reviewer(view, 0, signal())).resolves.toMatchObject({ verdict: "reviewed", findings: [body.findings[0]] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps valid findings and records when another citation was dropped", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response(JSON.stringify({ ...body,
      findings: [body.findings[0], { ...body.findings[0], quote: "Invented quotation" }],
    })));
    const result = await createRealParticipants({ apiKey: "test-key", execute }).reviewer(reviewer, 0, signal());
    expect(result.findings).toEqual([body.findings[0]]);
    expect(result.notes).toContain("已剔除 1 条");
  });

  it("assigns diagnostic objectives only to the routes that actually exercise them", () => {
    const [daily, occupation, boundaries] = regressionRoutes;
    expect(new Set(regressionRoutes.map((route) => route.expectedOutcome)).size).toBe(3);
    expect(daily.expectedOutcome).toContain("日常");
    expect(daily.expectedOutcome).not.toContain("职业");
    expect(occupation.expectedOutcome).toContain("职业");
    expect(occupation.expectedOutcome).toContain("澄清");
    expect(boundaries.expectedOutcome).toContain("朋友");
    expect(boundaries.expectedOutcome).toContain("称呼");
    expect(boundaries.expectedOutcome).not.toContain("职业");
    expect(regressionRoutes.every((route) => route.expectedOutcome.includes("不证明长期关系成长或跨会话记忆"))).toBe(true);
  });

  it("accepts no findings as reviewed with limitations, never blanket pass", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response(JSON.stringify({ notes: "未发现明确问题；证据有限。", evidenceSteps: [0], findings: [] })));
    expect(await createRealParticipants({ apiKey: "test-key", execute }).reviewer(reviewer, 1, signal())).toMatchObject({ verdict: "reviewed", findings: [] });
  });

  it("fails closed on pre-cancel without spending a request and propagates cancellation", async () => {
    const abort = new AbortController(); abort.abort();
    const execute = vi.fn<EvaluationHttpExecutor>();
    const participants = createRealParticipants({ apiKey: "test-key", execute });
    await expect(participants.user(user, abort.signal)).rejects.toThrow("REAL_PROVIDER_CANCELLED");
    await expect(participants.character(character, abort.signal)).rejects.toThrow("REAL_PROVIDER_CANCELLED");
    await expect(participants.reviewer(reviewer, 0, abort.signal)).rejects.toThrow("REAL_PROVIDER_CANCELLED");
    expect(execute).not.toHaveBeenCalled();
    const live = new AbortController();
    execute.mockImplementation(async ({ init }) => { expect(init?.signal).toBe(live.signal); live.abort(); return response("Hola"); });
    await expect(participants.user(user, live.signal)).rejects.toThrow("REAL_PROVIDER_CANCELLED");
  });

  it("does not expose error payloads, secrets or underlying transport errors", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockRejectedValue(new Error("SECRET_KEY request-body"));
    const participants = createRealParticipants({ apiKey: "SECRET_KEY", execute });
    await expect(participants.user(user, signal())).rejects.toThrow(/^REAL_PROVIDER_REQUEST_FAILED$/u);
    execute.mockResolvedValue(new Response("SECRET_KEY", { status: 401 }));
    await expect(participants.reviewer(reviewer, 0, signal())).rejects.toThrow(/^REAL_PROVIDER_AUTH_FAILED$/u);
    execute.mockResolvedValue(new Response("SECRET_KEY", { status: 200 }));
    await expect(participants.user(user, signal())).rejects.toThrow(/^REAL_PROVIDER_RESPONSE_INVALID$/u);
  });

  it.each(["user", "reviewer"] as const)("rejects malformed planning in %s final text without returning it", async (role) => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response("<think>PRIVATE_TEST_SENTINEL</think>Hola."));
    const participants = createRealParticipants({ apiKey: "test-key", execute });
    const result = role === "user" ? participants.user(user, signal()) : participants.reviewer(reviewer, 0, signal());
    await expect(result).rejects.toThrow(/^REAL_PROVIDER_FINAL_TEXT_CONTAMINATED$/u);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(["user", "reviewer"] as const)("rejects structural glyph/control corruption in %s final text", async (role) => {
    for (const text of ["Bueno^) lo entiendo.", "Hola\u0000."]) {
      const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response(text));
      const participants = createRealParticipants({ apiKey: "test-key", execute });
      const result = role === "user" ? participants.user(user, signal()) : participants.reviewer(reviewer, 0, signal());
      await expect(result).rejects.toThrow(/^REAL_PROVIDER_FINAL_TEXT_CONTAMINATED$/u);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it("preserves ordinary emoji in legacy model output", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>().mockResolvedValue(response("Hoy prefiero descansar. 🙂"));
    expect(await createRealParticipants({ apiKey: "test-key", execute }).user(user, signal())).toBe("Hoy prefiero descansar. 🙂");
  });
});
