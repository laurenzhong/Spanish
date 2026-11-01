// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toRelationshipDomainLedger } from "@/src/modules/character-network/repositories/to-relationship-domain-ledger";
import type { NormalizedRelationshipReceipts } from "@/src/modules/character-network/repositories/relationship-source-ledger";

const scope = { ownerId: "owner", identityId: "lucia", epoch: "epoch" };
function receipts(): { scope: typeof scope; messages: NormalizedRelationshipReceipts["messages"][number][]; turns: NormalizedRelationshipReceipts["turns"][number][]; sourceMetadata: NormalizedRelationshipReceipts["sourceMetadata"][number][]; missingRetainedUserMessageIds: string[] } {
  const base = { ...scope, conversationId: "conversation", status: "completed" as const, createdAtMs: 100, completedAtMs: 101 };
  return {
    scope,
    missingRetainedUserMessageIds: [],
    messages: [
      { ...base, id: "u1", role: "user", generationId: "original", characterVersion: 3 },
      { ...base, id: "a1", role: "assistant", generationId: "g1", characterVersion: 3 },
      { ...base, id: "a2", role: "assistant", generationId: "g2", characterVersion: 4 },
    ],
    turns: [3, 4].map((version, index) => ({ ...scope, id: `a${index + 1}`, assistantMessageId: `a${index + 1}`, generationId: `g${index + 1}`, conversationId: "conversation", userMessageIds: ["u1"], characterVersion: version, status: "completed" })),
    sourceMetadata: [{ ...scope, messageId: "u1", sessionId: "session", episodeId: "episode" }],
  };
}
describe("canonical relationship source projection", () => {
  it("preserves one user ID across generations and revision changes", () => {
    const input = receipts(), before = JSON.stringify(input);
    const ledger = toRelationshipDomainLedger(input);
    expect(ledger.messages.map(message => message.id).sort()).toEqual(["a1", "a2", "u1"]);
    const user = ledger.messages.find(message => message.id === "u1")!;
    expect(user).toMatchObject({ ...scope, sessionId: "session", episodeId: "episode", authoritativeTurnIds: ["a1", "a2"] });
    expect(user).not.toHaveProperty("generationId");
    expect(user).not.toHaveProperty("turnId");
    expect(user).not.toHaveProperty("characterVersion");
    expect(ledger.messages.find(message => message.id === "a2")).toMatchObject({ generationId: "g2", turnId: "a2", characterVersion: 4 });
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not turn a failed assistant into incomplete user evidence", () => {
    const input = receipts();
    input.messages[1] = { ...input.messages[1]!, status: "failed" };
    input.turns[0] = { ...input.turns[0]!, status: "failed" };
    const ledger = toRelationshipDomainLedger(input);
    expect(ledger.messages.find(message => message.id === "u1")?.status).toBe("completed");
    expect(ledger.turns[0]?.status).toBe("failed");
  });
  it("can carry a retained live user source without inventing a new turn", () => {
    const input = receipts();
    input.messages = input.messages.filter(message => message.role === "user");
    input.turns = [];
    const ledger = toRelationshipDomainLedger(input);
    expect(ledger.turns).toEqual([]);
    expect(ledger.messages).toHaveLength(1);
    expect(ledger.messages[0]).toMatchObject({ id: "u1", role: "user", authoritativeTurnIds: [] });
  });
  it.each(["missing-metadata", "duplicate-source", "foreign-scope", "missing-turn", "foreign-metadata"])("rejects inconsistent normalized receipts: %s", variant => {
    const input = receipts();
    if (variant === "missing-metadata") input.sourceMetadata = [];
    if (variant === "duplicate-source") input.messages = [...input.messages, input.messages[0]!];
    if (variant === "foreign-scope") input.messages[0] = { ...input.messages[0]!, ownerId: "other" };
    if (variant === "missing-turn") input.turns = input.turns.slice(1);
    if (variant === "foreign-metadata") input.sourceMetadata[0] = { ...input.sourceMetadata[0]!, epoch: "old" };
    expect(() => toRelationshipDomainLedger(input)).toThrow("RELATIONSHIP_SOURCE_PROJECTION_INVALID");
  });
});
