import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MiniMaxConversationProvider, OpenAIConversationProvider, type ConversationProviderInput } from "@/src/modules/providers/conversation/server";

const context: ConversationProviderInput = {
  userMessage: "¿En qué trabajas?", recentMessages: [], relationshipStage: "new_contact", relationshipSummary: null, memories: [], teachingOpportunity: null,
  character: { characterKey: "lucia", characterVersion: 2, displayName: "Lucía Martín", homeLocation: "Madrid", initiative: "balanced", tone: ["natural"], topics: ["fotografía"],
    identity: { age: 24, growthLocation: "Madrid", education: "EDUCATION_SENTINEL", occupation: "OCCUPATION_SENTINEL" }, traits: ["TRAIT_SENTINEL"],
    facts: [
      { factKey: "boundary.ai-identity", statement: "Soy un personaje de IA.", sensitivity: "normal", reveal: "direct" },
      { factKey: "private.secret", statement: "HIDDEN_CANON_SENTINEL", sensitivity: "private", reveal: "direct" },
      { factKey: "background.never", statement: "NEVER_CANON_SENTINEL", sensitivity: "normal", reveal: "never" },
      { factKey: "background.gradual", statement: "GRADUAL_CANON_SENTINEL", sensitivity: "normal", reveal: "gradual" },
      { factKey: "context.work", statement: "CONTEXT_CANON_SENTINEL", sensitivity: "normal", reveal: "contextual", topic: "trabajas" },
      { factKey: "context.other", statement: "UNRELATED_CANON_SENTINEL", sensitivity: "normal", reveal: "contextual", topic: "comida" },
      { factKey: "relationship", statement: "RELATIONSHIP_CANON_SENTINEL", sensitivity: "normal", reveal: "direct", audience: "relationship" },
    ] },
};

describe("provider character privacy projection", () => {
  it.each(["minimax", "openai"] as const)("removes unavailable canon from the entire %s HTTP payload", async (kind) => {
    let body = "";
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify(kind === "minimax" ? { content: [{ type: "text", text: "Trabajo en comunicación digital." }] } : { output: [{ type: "message", content: [{ type: "output_text", text: "Trabajo en comunicación digital." }] }] }));
    });
    const provider = kind === "minimax" ? new MiniMaxConversationProvider({ apiKey: "test-key", fetchImplementation }) : new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation });
    await provider.generate(context);
    expect(body).not.toContain("HIDDEN_CANON_SENTINEL");
    expect(body).not.toContain("NEVER_CANON_SENTINEL");
    expect(body).not.toContain("GRADUAL_CANON_SENTINEL");
    expect(body).toContain("Soy un personaje de IA");
    expect(body).toContain("EDUCATION_SENTINEL");
    expect(body).toContain("OCCUPATION_SENTINEL");
    expect(body).toContain("TRAIT_SENTINEL");
    expect(body).toContain("CONTEXT_CANON_SENTINEL");
    expect(body).not.toContain("UNRELATED_CANON_SENTINEL");
    expect(body).not.toContain("RELATIONSHIP_CANON_SENTINEL");
  });
});
