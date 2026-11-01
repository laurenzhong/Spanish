import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MiniMaxConversationProvider, OpenAIConversationProvider, type ConversationProviderInput } from "@/src/modules/providers/conversation/server";
import { characterContextForProvider } from "@/src/modules/providers/conversation/conversation";

const context: ConversationProviderInput = {
  userMessage: "Hoy tengo mucho trabajo.",
  recentMessages: [{ role: "user", content: "Me gusta la fotografía, la música y el senderismo." }],
  relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
  character: {
    characterKey: "lucia", characterVersion: 3, displayName: "Lucía Martín", homeLocation: "Madrid",
    initiative: "balanced", tone: ["natural"], topics: ["fotografía urbana", "música", "senderismo"],
    facts: [{ factKey: "preference.photography", statement: "Le gusta la fotografía.", sensitivity: "normal", reveal: "contextual", topic: "fotografía" }],
  },
};

describe("hobbies as preferences rather than recurring events", () => {
  it("does not promote an explicitly closed hobby from the unanswered batch", () => {
    expect(characterContextForProvider({ ...context,
      userMessage: "No quiero hablar de fotografía.",
      unansweredUserMessages: ["Me gusta la fotografía.", "No quiero hablar de fotografía."],
    })).toMatchObject({ topics: [], facts: [] });
  });
  it("allows the user to reopen an earlier closed interest", () => {
    expect(characterContextForProvider({ ...context,
      userMessage: "Ahora sí quiero retomar la fotografía.",
      recentMessages: [{ role: "user", content: "No quiero hablar de fotografía." }],
    }).topics).toEqual(["fotografía urbana"]);
  });
  it("does not reactivate hobbies or contextual facts from answered history on an unrelated turn", () => {
    expect(characterContextForProvider(context)).toMatchObject({ topics: [], facts: [] });
  });

  it.each(["fotografía", "música", "senderismo"])("still answers a fresh user topic: %s", (topic) => {
    const result = characterContextForProvider({ ...context, userMessage: "Quiero hablar de " + topic + "." });
    expect(result.topics).toEqual(context.character.topics.filter(value => value.includes(topic)));
  });

  it("preserves an unanswered topic within the current batch", () => {
    expect(characterContextForProvider({
      ...context, userMessage: "He comprado un libro.",
      unansweredUserMessages: ["Me gusta la música.", "He comprado un libro."],
    }).topics).toEqual(["música"]);
  });

  it.each(["¿Qué aficiones tienes?", "¿Qué te gusta hacer en tu tiempo libre?", "你有什么爱好？"])("allows a direct character hobby question: %s", (userMessage) => {
    expect(characterContextForProvider({ ...context, recentMessages: [], userMessage }).topics).toEqual(context.character.topics);
  });

  it.each(["lucia", "mateo", "ines"])("applies the same history rule to %s without changing its canon", (characterKey) => {
    const character = { ...context.character, characterKey };
    expect(characterContextForProvider({ ...context, character }).topics).toEqual([]);
    expect(character.topics).toEqual(["fotografía urbana", "música", "senderismo"]);
    expect(character.facts).toHaveLength(1);
  });

  it.each(["daily_share", "memory_callback"] as const)("does not select a hobby merely from history for proactive %s", (source) => {
    const input: ConversationProviderInput = {
      ...context, inputKind: "proactive", proactiveMessageSource: source, userMessage: "",
    };
    expect(characterContextForProvider(input)).toMatchObject({ topics: [], facts: [] });
  });

  it.each(["minimax", "openai"] as const)("sends continuity without stale hobby promotion through %s", async (kind) => {
    let body: Record<string, unknown> = {};
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(kind === "minimax" ? { content: [{ type: "text", text: "Te leo." }] } : { output_text: "Te leo." }));
    });
    const provider = kind === "minimax"
      ? new MiniMaxConversationProvider({ apiKey: "test-key", fetchImplementation })
      : new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation });
    const memories: ConversationProviderInput["memories"] = [{ factKey: "interest.preference", category: "interest", content: "la música", confidence: 0.9, sensitivity: "normal", shareScope: "private" }];
    await provider.generate({ ...context, memories, inputKind: "proactive", userMessage: "", proactiveMessageSource: "daily_share",
      questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" } });
    const sent = JSON.parse(kind === "minimax" ? (body.messages as { content: { text: string }[] }[])[0]!.content[0]!.text : String(body.input));
    expect(sent.character).toMatchObject({ topics: [], facts: [] });
    // Continuity is retained; suppressing a suggestion is not deleting memory.
    expect(sent.recentMessages).toEqual(context.recentMessages);
    expect(sent.readableMemories).toEqual(memories);
    const system = String(kind === "minimax" ? body.system : body.instructions);
    expect(system).toContain("máximo 0 preguntas sustantivas");
    expect(system).toContain("No añadas preguntas recíprocas");
    expect(system).toContain("No pidas detalles");
    expect(system).toContain("A hobby is a preference, not evidence of a recent activity");
    expect(system).toContain("Do not turn a hobby into a profession or a daily routine");
    expect(system).toContain("Do not invent a new hobby event to justify contacting the user");
    expect(system).toContain("Everyday life is the default conversational center");
    expect(system).toContain("not a rotating checklist or a daily interview");
    expect(system).toContain("Do not assume the user is a student");
  });
});
