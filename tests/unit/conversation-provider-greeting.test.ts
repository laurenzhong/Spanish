import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxConversationProvider,
  OpenAIConversationProvider,
  type ConversationProviderInput,
} from "@/src/modules/providers/conversation/server";

const input: ConversationProviderInput = {
  userMessage: "Pues sí, es una buena idea.",
  recentMessages: [
    { role: "character", content: "¡Hola! Yo bien, ya funcionando a tope. ¿Tú qué tal?", sentAt: "2026-10-21T08:40:45.000Z" },
    { role: "character", content: "Uff, los días de lluvia me vuelven un poco loca para fotografiar.", sentAt: "2026-10-21T08:53:03.000Z" },
  ],
  currentLocalDate: "2026-10-21",
  conversationTimeZone: "Europe/Madrid",
  alreadyGreetedToday: true,
  character: {
    characterKey: "lucia",
    characterVersion: 3,
    displayName: "Lucía Martín",
    homeLocation: "Madrid",
    initiative: "balanced",
    tone: ["cercana", "natural"],
    topics: ["fotografía urbana"],
    facts: [],
  },
  relationshipStage: "familiar",
  relationshipSummary: null,
  memories: [],
  teachingOpportunity: null,
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "x-request-id": "greeting-flag" } });
}

describe("provider same-day greeting projection", () => {
  it.each(["minimax", "openai"] as const)("passes alreadyGreetedToday to %s and tells the model not to greet again", async (kind) => {
    let body: Record<string, unknown> = {};
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(kind === "minimax"
        ? { content: [{ type: "text", text: "Me alegra que te guste la idea." }] }
        : { output_text: "Me alegra que te guste la idea." });
    });
    const provider = kind === "minimax"
      ? new MiniMaxConversationProvider({ apiKey: "test-key", fetchImplementation })
      : new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation });

    await provider.generate(input);

    const serialized = kind === "minimax"
      ? JSON.parse(((body.messages as { content: { text: string }[] }[])[0]!.content[0]!.text))
      : JSON.parse(String(body.input));
    expect(serialized.alreadyGreetedToday).toBe(true);
    expect(serialized.currentLocalDate).toBe("2026-10-21");

    const instructions = kind === "minimax" ? String(body.system) : String(body.instructions);
    expect(instructions).toContain("alreadyGreetedToday");
    expect(instructions).toContain("Greet at most once per day");
  });

  it.each(["minimax", "openai"] as const)("omits the flag for %s when the day has no greeting yet", async (kind) => {
    let body: Record<string, unknown> = {};
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(kind === "minimax"
        ? { content: [{ type: "text", text: "Vaya, currando en finde." }] }
        : { output_text: "Vaya, currando en finde." });
    });
    const provider = kind === "minimax"
      ? new MiniMaxConversationProvider({ apiKey: "test-key", fetchImplementation })
      : new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation });

    await provider.generate({ ...input, alreadyGreetedToday: false });

    const serialized = kind === "minimax"
      ? JSON.parse(((body.messages as { content: { text: string }[] }[])[0]!.content[0]!.text))
      : JSON.parse(String(body.input));
    expect(serialized.alreadyGreetedToday).toBe(false);
  });
});
