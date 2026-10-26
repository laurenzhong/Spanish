// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { coreRoutes, makeOfflineManifest, romanceConfirmationRoute } from "../../scripts/conversation-evaluation/routes";
import { reviewQuoteMatches, runTrajectory, forkCheckpoint } from "../../scripts/conversation-evaluation/runner";
import { renderReports } from "../../scripts/conversation-evaluation/store";
import { manifestSchema, estimateBaselineBudget } from "../../scripts/conversation-evaluation/manifest";
import type { ConversationProviderInput } from "../../src/modules/providers/conversation/conversation";

const route = () => ({ ...structuredClone(coreRoutes[0]), steps: structuredClone(coreRoutes[0].steps.slice(0, 4)) });
const manifest = () => makeOfflineManifest({ runId: "test-run", trajectoryId: "r01-test", route: route() });

describe("offline longitudinal evaluation", () => {
  it("accepts reviewer quotes with harmless line-wrap whitespace", () => {
    expect(reviewQuoteMatches("Lucía responde\ncon calma.", "responde con   calma.")).toBe(true);
    expect(reviewQuoteMatches("Lucía responde con calma.", "responde otra cosa.")).toBe(false);
  });

  it("assigns a real step to proactive messages so reviews can cite them safely", async () => {
    const proactiveRoute = { ...coreRoutes[0], steps: structuredClone(coreRoutes[0].steps.slice(0, 13)) };
    const proactiveManifest = makeOfflineManifest({ runId: "review-proactive", trajectoryId: "r01-proactive", route: proactiveRoute });
    const result = await runTrajectory({ manifest: proactiveManifest, route: proactiveRoute, participants: {
      reviewer: async (view) => {
        const proactive = view.transcript.find((message) => message.step === 12);
        expect(proactive).toBeDefined();
        return { reviewer: "proactive-citation", verdict: "reviewed", notes: "引用主动消息。", evidenceSteps: [12],
          findings: [{ severity: "low", category: "fixture", step: 12, quote: proactive!.content, issue: "Fixture." }] };
      },
    } });
    expect(result.status).toBe("completed");
    expect(result.reviews).toHaveLength(2);
  });

  it("keeps a transient proactive provider failure non-fatal to the route", async () => {
    const proactiveRoute = { ...coreRoutes[0], steps: structuredClone(coreRoutes[0].steps.slice(0, 13)) };
    const proactiveManifest = makeOfflineManifest({ runId: "proactive-provider-failure", trajectoryId: "r01-proactive-failure", route: proactiveRoute });
    const result = await runTrajectory({ manifest: proactiveManifest, route: proactiveRoute, participants: {
      character: async (context) => {
        if (context.inputKind === "proactive") throw new Error("provider-unavailable");
        return proactiveRoute.steps.find((step) => step.kind === "user" && step.lifeEvent === context.userMessage)?.fakeReply ?? "De acuerdo.";
      },
    } });
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeNull();
    expect(result.turns.at(-1)).toMatchObject({ kind: "proactive", done: false, result: "provider-unavailable" });
    expect(result.reviews).toHaveLength(2);
  });
  it("rejects real execution, traversal IDs and an unknown priced model", () => {
    expect(() => manifestSchema.parse({ ...manifest(), mode: "real" })).toThrow();
    expect(() => manifestSchema.parse({ ...manifest(), trajectoryId: "../owner" })).toThrow();
    expect(() => estimateBaselineBudget("unpriced-model")).toThrow("UNKNOWN_PRICE");
    const estimate = estimateBaselineBudget("MiniMax-M3.1-Flash");
    expect(estimate.totalCalls).toBe(234);
    expect(estimate.roles.character.calls).toBe(156);
    expect(estimate.totalCny).toBeGreaterThan(0);
  });

  it("records an explicit bounded safety retry limit and charges each retry attempt", async () => {
    const r = route();
    r.steps = r.steps.slice(0, 1);
    const m = { ...makeOfflineManifest({ runId: "safety-retry-runner", trajectoryId: "r01-safety-retry", route: r }), safetyRetryLimit: 2 };
    let calls = 0;
    const result = await runTrajectory({ manifest: m, route: r, participants: {
      character: async () => {
        calls += 1;
        return calls < 3 ? "你好，污染候选。" : "Qué bien saber de ti.";
      },
    } });
    expect(result.status).toBe("completed");
    expect(result.manifest.safetyRetryLimit).toBe(2);
    expect(calls).toBe(3);
    expect(result.ledger.character.calls).toBe(3);
    expect(result.traces.filter((trace) => trace.role === "character")).toHaveLength(3);
    expect(result.sandbox.messages.at(-1)?.content).toBe("Qué bien saber de ti.");
  });

  it("starts from product opening, extracts memories and reports unsupported growth", async () => {
    const result = await runTrajectory({ manifest: manifest(), route: route() });
    expect(result.status).toBe("completed");
    expect(result.turns).toHaveLength(4);
    expect(result.sandbox.messages[0].sourceType).toBe("authored_opening");
    expect(result.sandbox.messages.filter((m) => m.sourceType === "authored_opening")).toHaveLength(1);
    expect(result.sandbox.memories.some((m) => m.content.includes("cocinar"))).toBe(true);
    expect(result.sandbox.relationshipStage).toBe("new_contact");
    expect(result.limitations).not.toContain("RELATIONSHIP_GROWTH_UNSUPPORTED");
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews.every((r) => r.verdict === "not_evaluated" && r.reviewer.startsWith("fake"))).toBe(true);
  });

  it("projects completed relationship evidence into context, turns, and checkpoints", async () => {
    const r = route();
    r.steps[0].lifeEvent = "Quiero contarte algo de mi familia.";
    r.steps[1].lifeEvent = "Me gusta hablar contigo.";
    r.steps[2].lifeEvent = "He vuelto, me alegra encontrarte aquí.";
    r.steps[2].session = 2;
    r.steps[2].at = new Date(Date.UTC(2026, 9, 27, 10, 0)).toISOString();
    r.steps[3].session = 2;
    r.steps[3].at = new Date(Date.UTC(2026, 9, 27, 10, 5)).toISOString();
    const m = makeOfflineManifest({ runId: "relationship-runner", trajectoryId: "r01", route: r });
    const contexts: ConversationProviderInput[] = [];
    const result = await runTrajectory({ manifest: m, route: r, participants: {
      character: async (context) => { contexts.push(context); return r.steps[contexts.length - 1].fakeReply; },
    } });
    expect(result.status).toBe("completed");
    expect(result.relationship.state.familiarity).toBe("familiar");
    expect(result.sandbox.relationshipStage).toBe("familiar");
    expect(result.turns[0].stageBefore).toBe("new_contact");
    expect(result.turns.at(-1)?.stageAfter).toBe("familiar");
    expect(contexts[1]?.relationshipStage).toBe("new_contact");
    expect(contexts[2]?.relationshipStage).toBe("getting_to_know_you");
  });

  it("reaches close friendship only after independent trust and positive exchanges", async () => {
    const r = route();
    const events = [
      [1, "Hola, soy Álex. Me gusta cocinar.", "Qué bien conocerte."],
      [1, "Me alegra hablar contigo.", "A mí también me gusta hablar contigo."],
      [2, "Buenas, vuelvo después de unos días.", "Me alegra verte de nuevo."],
      [3, "Confío en ti y puedo contarte algo importante.", "Gracias por confiar en mí."],
      [4, "Me hace feliz compartir esto contigo.", "También valoro mucho nuestras conversaciones."],
      [5, "He vuelto; me gusta que podamos hablar así.", "Qué bien seguir encontrándonos con calma."],
    ] as const;
    r.steps = events.map(([session, lifeEvent, fakeReply], index) => ({
      session, kind: "user" as const, at: new Date(Date.UTC(2026, 9, 25 + index, 10, 0)).toISOString(), lifeEvent, fakeReply,
    }));
    const m = makeOfflineManifest({ runId: "close-friend-runner", trajectoryId: "r01", route: r });
    const result = await runTrajectory({ manifest: m, route: r });
    expect(result.status).toBe("completed");
    expect(result.relationship.state.familiarity).toBe("close_friend");
    expect(result.sandbox.relationshipStage).toBe("close_friend");
  });

  it("keeps the romantic confirmation path ordered and evidence-bound", async () => {
    const r = route();
    const events = [
      [1, "Hola, soy Álex. Me gusta cocinar.", "Qué bien conocerte."],
      [1, "Me alegra hablar contigo.", "A mí también me gusta hablar contigo."],
      [2, "Buenas, vuelvo después de unos días.", "Me alegra verte de nuevo."],
      [3, "Me gustas, pero prefiero que nos demos tiempo.", "Gracias por decírmelo. A mí también me gustas; podemos ir con calma."],
      [4, "Me hace feliz compartir esto contigo.", "También valoro mucho lo que compartimos."],
      [4, "Me gustaría que fuéramos algo más.", "Quiero que seamos algo más."],
      [5, "Sí, quiero que seamos algo.", "Me alegra; acepto estar contigo."],
    ] as const;
    r.steps = events.map(([session, lifeEvent, fakeReply], index) => ({
      session, kind: "user" as const, at: new Date(Date.UTC(2026, 9, 25 + index, 10, 0)).toISOString(), lifeEvent, fakeReply,
    }));
    const m = makeOfflineManifest({ runId: "romantic-confirmation-runner", trajectoryId: "r04", route: r });
    const result = await runTrajectory({ manifest: m, route: r });
    expect(result.status).toBe("completed");
    expect(result.relationship.state.userRomanticIntent).toBe("confirmed");
    expect(result.relationship.state.characterProposal).toBe("confirmed");
  });

  it("runs the dedicated confirmation route through proposal, confirmation, and ordinary follow-up", async () => {
    const route = structuredClone(romanceConfirmationRoute);
    const manifest = makeOfflineManifest({ runId: "romance-confirmation-route", trajectoryId: "r06", route });
    const result = await runTrajectory({ manifest, route });
    expect(result.status).toBe("completed");
    expect(result.relationship.state.userRomanticIntent).toBe("confirmed");
    expect(result.relationship.state.characterProposal).toBe("confirmed");
    expect(result.turns.at(-1)).toMatchObject({ kind: "user", done: true, stageAfter: "familiar" });
    expect(result.sandbox.messages.at(-1)?.content).toBe("Claro, que disfrutes de la cena.");
  });

  it("rejects an opening citation falsely assigned to step zero and labels review failure separately", async () => {
    const reviewer = vi.fn(async (view: { transcript: { content: string; step?: number }[] }) => {
      expect(view.transcript[0].step).toBeUndefined();
      return { reviewer: "citation-fixture", verdict: "reviewed" as const, notes: "Invalid opening citation fixture.", evidenceSteps: [0],
        findings: [{ severity: "medium" as const, category: "opening", step: 0, quote: view.transcript[0].content, issue: "Fixture." }] };
    });
    const result = await runTrajectory({ manifest: manifest(), route: route(), participants: { reviewer } });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("REVIEW_EVIDENCE_INVALID");
    expect(result.cursor).toBe(route().steps.length);
    expect(result.turns.every((turn) => turn.done)).toBe(true);
    expect(result.reviews).toHaveLength(0);
    expect(reviewer).toHaveBeenCalledTimes(1);
  });

  it("accepts review evidence tied to the exact conversation step", async () => {
    const result = await runTrajectory({ manifest: manifest(), route: route(), participants: {
      reviewer: async (view, index) => ({ reviewer: `citation-fixture-${index}`, verdict: "reviewed", notes: "Valid citation fixture.", evidenceSteps: [0],
        findings: [{ severity: "low", category: "fixture", step: 0, quote: view.transcript.find((message) => message.step === 0)!.content, issue: "Fixture." }] }),
    } });
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeNull();
    expect(result.reviews).toHaveLength(2);
  });


  it("reports generic reviewer errors with a safe review-stage code after successful chat", async () => {
    const result = await runTrajectory({ manifest: manifest(), route: route(), participants: {
      reviewer: async () => { throw new Error("private-provider-detail-must-not-be-persisted"); },
    } });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("REVIEW_FAILED");
    expect(result.turns.every((turn) => turn.done)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-provider-detail-must-not-be-persisted");
    // Previously archived terminal records keep their original code and bytes on resume.
    const legacy = JSON.parse(JSON.stringify({ ...result, errorCode: "PARTICIPANT_OR_APPLICATION_FAILED" }));
    const persist = vi.fn();
    const reviewer = vi.fn();
    const resumed = await runTrajectory({ manifest: manifest(), route: route(), checkpoint: legacy, persist, participants: { reviewer } });
    expect(JSON.parse(JSON.stringify(resumed))).toEqual(legacy);
    expect(JSON.stringify(renderReports(resumed, route()))).toBe(JSON.stringify(renderReports(legacy, route())));
    expect(persist).not.toHaveBeenCalled();
    expect(reviewer).not.toHaveBeenCalled();
  });

  it("does not mislabel a simulated-user failure as an evaluation review error", async () => {
    const result = await runTrajectory({ manifest: manifest(), route: route(), participants: {
      user: async () => { throw new Error("REVIEW_EVIDENCE_INVALID"); },
    } });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("PARTICIPANT_OR_APPLICATION_FAILED");
    expect(result.turns).toHaveLength(0);
  });

  it("retains first-session memory through a serialized checkpoint into the next session", async () => {
    const r = { ...route(), steps: structuredClone(coreRoutes[0].steps.slice(0, 8)) };
    const m = makeOfflineManifest({ runId: "cross-session", trajectoryId: "r01", route: r });
    const paused = await runTrajectory({ manifest: m, route: r, stopAfterTurns: 6 });
    expect(paused.status).toBe("paused");
    expect(paused.turns.every((turn) => turn.session === 1)).toBe(true);
    const cooking = paused.sandbox.memories.find((memory) => memory.content.includes("cocinar"));
    expect(cooking).toBeDefined();
    const contexts: ConversationProviderInput[] = [];
    const done = await runTrajectory({ manifest: m, route: r, checkpoint: JSON.parse(JSON.stringify(paused)), participants: {
      character: async (context) => {
        contexts.push(context);
        return r.steps[5 + contexts.length].fakeReply;
      },
    } });
    expect(done.status).toBe("completed");
    expect(done.turns.slice(6).map((turn) => turn.session)).toEqual([2, 2]);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].memories).toEqual(expect.arrayContaining([expect.objectContaining({ factKey: cooking!.factKey, content: cooking!.content })]));
    expect(done.sandbox.memories.find((memory) => memory.id === cooking!.id)).toEqual(cooking);
    expect(done.sandbox.messages.filter((message) => message.sourceType === "authored_opening")).toHaveLength(1);
  });

  it.each(["message-count", "character-budget"] as const)("preserves complete history while projecting the product %s context cap", async (cap) => {
    const r = route();
    r.steps = Array.from({ length: 56 }, (_, index) => ({
      ...r.steps[index % 4],
      session: Math.floor(index / 6) + 1,
      at: new Date(Date.UTC(2026, 9, 25 + Math.floor(index / 6), 10, index % 6)).toISOString(),
      lifeEvent: `Hoy he leído la página ${index + 1}.` + (cap === "character-budget" ? " El relato describe un paisaje tranquilo con árboles junto al río.".repeat(8) : ""),
    }));
    const m = makeOfflineManifest({ runId: "long-history", trajectoryId: "r01", route: r });
    for (const role of ["user", "character"] as const) {
      m.budget[role].maxCalls = 56;
      m.budget[role].maxReservedTokens = 56 * (m.budget[role].inputTokensPerCall + m.budget[role].outputTokensPerCall);
    }
    const contexts: ConversationProviderInput[] = [];
    const done = await runTrajectory({ manifest: m, route: r, participants: {
      character: async (context) => {
        contexts.push(context);
        return r.steps[contexts.length - 1].fakeReply;
      },
    } });
    expect(done.status).toBe("completed");
    expect(done.turns).toHaveLength(56);
    expect(done.sandbox.messages).toHaveLength(113);
    expect(done.sandbox.messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual(r.steps.map((step) => step.lifeEvent));
    const last = contexts.at(-1)!;
    if (cap === "message-count") expect(last.recentMessages).toHaveLength(100);
    else expect(last.recentMessages.length).toBeLessThan(100);
    expect(last.recentMessages.reduce((sum, message) => sum + message.content.length + 16, 0)).toBeLessThanOrEqual(8000);
    expect(last.recentMessages.some((message) => message.content === r.steps[0].lifeEvent)).toBe(false);
    expect(last.recentMessages.at(-1)?.content).toBe(r.steps[54].fakeReply);
    expect(done.sandbox.messages[0].sourceType).toBe("authored_opening");
    expect(done.sandbox.messages[1].content).toBe(r.steps[0].lifeEvent);
  });

  it("does not expose target outcomes or hidden memories to the simulated user", async () => {
    const inputs: unknown[] = [];
    await runTrajectory({ manifest: manifest(), route: route(), participants: {
      user: async (input) => { inputs.push(input); return input.lifeEvent; },
    } });
    const serialized = JSON.stringify(inputs);
    expect(serialized).not.toContain("expectedOutcome");
    expect(serialized).not.toContain("relationshipStage");
    expect(serialized).not.toContain("memories");
    expect(serialized).not.toContain("mustAvoid");
    expect(inputs).toHaveLength(4);
  });

  it("resumes completed checkpoints without regenerating or duplicating memory", async () => {
    const paused = await runTrajectory({ manifest: manifest(), route: route(), stopAfterTurns: 2 });
    expect(paused.status).toBe("paused");
    const restored = JSON.parse(JSON.stringify(paused));
    const done = await runTrajectory({ manifest: manifest(), route: route(), checkpoint: restored });
    expect(done.status).toBe("completed");
    expect(done.sandbox.messages.filter((m) => m.role === "user")).toHaveLength(4);
    expect(new Set(done.sandbox.memories.map((m) => m.id)).size).toBe(done.sandbox.memories.length);
    const user = vi.fn();
    const again = await runTrajectory({ manifest: manifest(), route: route(), checkpoint: JSON.parse(JSON.stringify(done)), participants: { user } });
    expect(user).not.toHaveBeenCalled();
    expect(again.traces).toHaveLength(done.traces.length);
  });

  it("preserves rejected candidates and makes no memories when both replies fail the gate", async () => {
    const result = await runTrajectory({ manifest: manifest(), route: route(), participants: {
      character: async () => "你好，中文污染。",
    } });
    expect(result.status).toBe("failed");
    expect(result.traces.filter((t) => t.role === "character")).toHaveLength(2);
    expect(result.sandbox.memories).toHaveLength(0);
    expect(result.sandbox.messages.filter((m) => m.role === "character")).toHaveLength(1);
    expect(result.turns[0].done).toBe(false);
  });

  it("reserves every attempt before invocation and stops at the budget", async () => {
    const m = manifest(); m.budget.character.maxCalls = 1;
    const result = await runTrajectory({ manifest: m, route: route(), participants: { character: async () => "你好" } });
    expect(result.status).toBe("budget_exhausted");
    expect(result.ledger.character.calls).toBe(1);
    expect(result.traces.filter((t) => t.role === "character")).toHaveLength(1);
    expect(result.sandbox.memories).toHaveLength(0);
  });

  it.each(["user", "character", "reviewer"] as const)("enforces the %s token cap independently of its call limit", async (role) => {
    const m = manifest();
    const reservation = m.budget[role].inputTokensPerCall + m.budget[role].outputTokensPerCall;
    m.budget[role].maxReservedTokens = reservation;
    const participants = {
      user: vi.fn(async (input: { lifeEvent: string }) => input.lifeEvent),
      character: vi.fn(async (input: ConversationProviderInput) => route().steps.find((step) => step.lifeEvent === input.userMessage)!.fakeReply),
      reviewer: vi.fn(async () => ({ reviewer: "fake-token-cap", verdict: "not_evaluated" as const, notes: "Structural fixture", evidenceSteps: [] })),
    };
    const result = await runTrajectory({ manifest: m, route: route(), participants });
    expect(result.status).toBe("budget_exhausted");
    expect(result.ledger[role]).toEqual({ calls: 1, reservedTokens: reservation });
    expect(result.ledger[role].calls).toBeLessThan(m.budget[role].maxCalls);
    expect(participants[role]).toHaveBeenCalledTimes(1);
    expect(result.traces.filter((trace) => trace.role === role)).toHaveLength(1);
  });

  it("records pre-call checkpoints and refuses an ambiguous call on recovery", async () => {
    let durable: unknown;
    await expect(runTrajectory({ manifest: manifest(), route: route(), persist: async (state) => {
      durable = JSON.parse(JSON.stringify(state));
      if (state.pending) throw new Error("disk-interrupted");
    } })).rejects.toThrow("disk-interrupted");
    const user = vi.fn();
    const result = await runTrajectory({ manifest: manifest(), route: route(), checkpoint: durable, participants: { user } });
    expect(result.status).toBe("interrupted");
    expect(user).not.toHaveBeenCalled();
    const terminalBytes = JSON.stringify(result);
    const persist = vi.fn();
    for (let attempt = 0; attempt < 2; attempt++) {
      const again = await runTrajectory({ manifest: manifest(), route: route(), checkpoint: JSON.parse(terminalBytes), participants: { user }, persist });
      expect(JSON.stringify(again)).toBe(terminalBytes);
    }
    expect(user).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("cancels before dispatch and enforces wall time on an uncooperative participant", async () => {
    const controller = new AbortController(); controller.abort();
    const user = vi.fn();
    const stopped = await runTrajectory({ manifest: manifest(), route: route(), signal: controller.signal, participants: { user } });
    expect(stopped.status).toBe("cancelled");
    expect(user).not.toHaveBeenCalled();
    const m = manifest(); m.maxWallMs = 30;
    const timedOut = await runTrajectory({ manifest: m, route: route(), participants: { user: async () => new Promise(() => {}) } });
    expect(timedOut.status).toBe("budget_exhausted");
    expect(timedOut.sandbox.messages).toHaveLength(1);
  });

  it("refuses changed manifest and isolates explicitly labelled checkpoint forks", async () => {
    const paused = await runTrajectory({ manifest: manifest(), route: route(), stopAfterTurns: 2 });
    const changed = { ...manifest(), codeFingerprint: "a".repeat(64) };
    await expect(runTrajectory({ manifest: changed, route: route(), checkpoint: paused })).rejects.toThrow("CHECKPOINT_MISMATCH");
    const childManifest = { ...manifest(), trajectoryId: "r01-child" };
    const child = forkCheckpoint(paused, childManifest, route());
    expect(child.parent?.trajectoryId).toBe(paused.manifest.trajectoryId);
    expect(child.sandbox.userId).not.toBe(paused.sandbox.userId);
    child.sandbox.messages[0] = { ...child.sandbox.messages[0], content: "changed only in child" };
    expect(paused.sandbox.messages[0].content).not.toBe(child.sandbox.messages[0].content);
  });

  it("allows a changed fork continuation but rejects rewriting an already completed prefix", async () => {
    const paused = await runTrajectory({ manifest: manifest(), route: route(), stopAfterTurns: 2 });
    const parentBytes = JSON.stringify(paused);
    const continuation = route();
    continuation.steps[2].lifeEvent = "He encontrado un poema en la librería.";
    continuation.steps[2].fakeReply = "Un poema puede acompañarte todo el día.";
    const childManifest = makeOfflineManifest({ runId: "test-run", trajectoryId: "r01-divergent", route: continuation });
    const child = forkCheckpoint(JSON.parse(parentBytes), childManifest, continuation);
    const done = await runTrajectory({ manifest: childManifest, route: continuation, checkpoint: JSON.parse(JSON.stringify(child)) });
    expect(done.status).toBe("completed");
    expect(done.parent?.cursor).toBe(2);
    expect(done.sandbox.messages.slice(0, 5)).toEqual(paused.sandbox.messages);
    expect(done.sandbox.messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual(continuation.steps.map((step) => step.lifeEvent));
    expect(JSON.stringify(paused)).toBe(parentBytes);
    const changedPrefix = structuredClone(continuation);
    changedPrefix.steps[0].lifeEvent = "Hola, soy otra persona.";
    const changedManifest = makeOfflineManifest({ runId: "test-run", trajectoryId: "r01-invalid-prefix", route: changedPrefix });
    expect(() => forkCheckpoint(paused, changedManifest, changedPrefix)).toThrow("FORK_ROUTE_MISMATCH");
  });

  it("does not invoke after a slow reservation has exhausted the wall budget", async () => {
    const m = manifest(); m.maxWallMs = 40;
    const user = vi.fn(async () => "Hola");
    const result = await runTrajectory({ manifest: m, route: route(), participants: { user }, persist: async (state) => {
      if (state.pending) await new Promise((resolve) => setTimeout(resolve, 60));
    } });
    expect(result.status).toBe("budget_exhausted");
    expect(user).not.toHaveBeenCalled();
  });

  it("does not commit proactive messages when cancelled during result persistence", async () => {
    const r = { ...route(), steps: [route().steps[0], coreRoutes[0].steps.find((s) => s.kind === "proactive")!] };
    const m = makeOfflineManifest({ runId: "cancel-proactive", trajectoryId: "r01", route: r });
    const controller = new AbortController();
    const result = await runTrajectory({ manifest: m, route: r, signal: controller.signal, persist: async (state) => {
      if (state.cursor === 1 && !state.pending && state.traces.some((t) => t.role === "character" && t.step === 1)) controller.abort();
    } });
    expect(result.status).toBe("cancelled");
    expect(result.sandbox.messages.some((m) => m.sourceType === "proactive")).toBe(false);
  });

  it("does not repeat a reviewer whose result was returned before a crash", async () => {
    let checkpoint: unknown;
    await expect(runTrajectory({ manifest: manifest(), route: route(), persist: async (state) => {
      if (!state.pending && state.traces.some((t) => t.role === "reviewer") && state.reviews.length === 0) {
        checkpoint = JSON.parse(JSON.stringify(state)); throw new Error("review-crash");
      }
    } })).rejects.toThrow("review-crash");
    const reviewer = vi.fn();
    const result = await runTrajectory({ manifest: manifest(), route: route(), checkpoint, participants: { reviewer } });
    expect(result.status).toBe("interrupted");
    expect(reviewer).not.toHaveBeenCalled();
  });

  it("rejects impossible cursor and budget ledgers in recovered checkpoints", async () => {
    const paused = await runTrajectory({ manifest: manifest(), route: route(), stopAfterTurns: 2 });
    await expect(runTrajectory({ manifest: manifest(), route: route(), checkpoint: { ...paused, cursor: 3 } })).rejects.toThrow("CHECKPOINT_INCONSISTENT");
    const altered = structuredClone(paused); altered.ledger.character.calls = 0; altered.ledger.character.reservedTokens = 0;
    await expect(runTrajectory({ manifest: manifest(), route: route(), checkpoint: altered })).rejects.toThrow("CHECKPOINT_INCONSISTENT");
  });
});
