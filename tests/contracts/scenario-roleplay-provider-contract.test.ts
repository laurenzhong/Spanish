import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxScenarioRoleplayProvider, OpenAIScenarioRoleplayProvider } from "@/src/modules/providers/scenario-roleplay/server";

const input = {
  requestId: "request-1", sessionId: "session-1", generationId: "generation-1",
  temporaryCharacter: { displayName: "Elena", role: "虚构房源联系人", locale: "es-ES" },
  communicationGoal: "询问虚构房源条件", conditionSnapshot: ["La hora ficticia ya no está disponible."],
  completedTurns: [{ speaker: "user" as const, text: "¿Cuánto cuesta el alquiler?" }],
};

describe("MiniMax scenario roleplay contract", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("converts a validated provider response into delta and done events", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("虚构房源联系人");
      expect(String(init?.body)).not.toContain("relationshipMemories");
      return new Response(JSON.stringify({ content: [{ type: "text", text: "En este ejercicio, son setecientos euros." }] }), { status: 200 });
    });
    const provider = new MiniMaxScenarioRoleplayProvider({ apiKey: "test-key", fetchImplementation });
    const events = [];
    for await (const event of provider.stream(input)) events.push(event);
    expect(events).toEqual([
      { type: "delta", generationId: "generation-1", text: "En este ejercicio, son setecientos euros." },
      { type: "done", generationId: "generation-1" },
    ]);
  });

  it("returns an honest configuration error instead of a fake reply", async () => {
    const provider = new MiniMaxScenarioRoleplayProvider({ apiKey: "" });
    await expect(async () => { for await (const event of provider.stream(input)) void event; }).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("keeps OpenAI roleplay inside the temporary-character contract", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("虚构房源联系人");
      expect(String(init?.body)).not.toContain("relationshipMemories");
      return new Response(JSON.stringify({ output_text: "En este ejercicio, son setecientos euros." }), { status: 200 });
    });
    const provider = new OpenAIScenarioRoleplayProvider({ apiKey: "test-key", fetchImplementation });
    const events = [];
    for await (const event of provider.stream(input)) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["delta", "done"]);
    expect(events[0]).toMatchObject({ text: "En este ejercicio, son setecientos euros." });
  });
});
