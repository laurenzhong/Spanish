// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextRelationshipSession, RELATIONSHIP_SESSION_GAP_MS } from "@/src/modules/character-network/domain/relationship-session";

const scope = { ownerId: "owner-1", identityId: "lucia-identity", epoch: "reset-1" };
const firstAt = Date.UTC(2026, 9, 25, 8);
const message = (id = "message-1", sequence = 1, createdAtMs = firstAt) => ({
  ...scope, id, sequence, createdAtMs, role: "user" as const, status: "completed" as const,
});

describe("server-derived relationship sessions", () => {
  it("starts with the persisted user source and is exactly idempotent", () => {
    const first = nextRelationshipSession({ scope, message: message() });
    expect(first.sessionId).toBe("relationship-session:message-1");
    expect(nextRelationshipSession({ scope, previous: first, message: message() })).toEqual(first);
  });
  it("keeps a session below four hours and starts a new one at the exact boundary", () => {
    const first = nextRelationshipSession({ scope, message: message() });
    expect(RELATIONSHIP_SESSION_GAP_MS).toBe(4 * 60 * 60 * 1000);
    const near = nextRelationshipSession({ scope, previous: first, message: message("message-2", 2, firstAt + RELATIONSHIP_SESSION_GAP_MS - 1) });
    expect(near.sessionId).toBe(first.sessionId);
    const next = nextRelationshipSession({ scope, previous: near, message: message("message-3", 3, near.lastUserMessageAtMs + RELATIONSHIP_SESSION_GAP_MS) });
    expect(next.sessionId).toBe("relationship-session:message-3");
    expect(first.lastUserMessageId).toBe("message-1");
  });
  it("supports long absence without interpreting it as relationship evidence", () => {
    const first = nextRelationshipSession({ scope, message: message() });
    const next = nextRelationshipSession({ scope, previous: first, message: message("message-2", 2, firstAt + 90 * 86400000) });
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(Object.keys(next).sort()).toEqual(["ownerId", "identityId", "epoch", "sessionId", "lastUserMessageId", "lastUserMessageAtMs", "lastSequence"].sort());
  });
  it.each([
    { ownerId: "other" }, { identityId: "other" }, { epoch: "reset-2" },
    { role: "character" }, { status: "streaming" }, { status: "withdrawn" },
    { createdAtMs: NaN }, { createdAtMs: Infinity }, { createdAtMs: -1 },
    { sequence: 0 }, { sequence: 1.5 }, { id: "" },
  ])("refuses untrusted or incomplete source metadata %#", patch => {
    expect(() => nextRelationshipSession({ scope, message: { ...message(), ...patch } as ReturnType<typeof message> })).toThrow();
  });
  it("rejects stale sources, changed replay metadata and a prior state from another reset", () => {
    const first = nextRelationshipSession({ scope, message: message() });
    const next = nextRelationshipSession({ scope, previous: first, message: message("message-2", 2, firstAt + 1000) });
    expect(() => nextRelationshipSession({ scope, previous: next, message: message() })).toThrow("STALE_RELATIONSHIP_SOURCE");
    expect(() => nextRelationshipSession({ scope, previous: first, message: message("changed", 1) })).toThrow();
    expect(() => nextRelationshipSession({ scope, previous: first, message: message("message-1", 2) })).toThrow();
    expect(() => nextRelationshipSession({ scope, previous: first, message: message("message-2", 2, firstAt - 1) })).toThrow();
    expect(() => nextRelationshipSession({ scope, previous: { ...first, epoch: "old" }, message: message("message-2", 2) })).toThrow();
  });
  it("survives serialization and timezone differences using server timestamps", () => {
    const first = nextRelationshipSession({ scope, message: message() });
    const restored = JSON.parse(JSON.stringify(first));
    expect(nextRelationshipSession({ scope, previous: restored, message: message("message-2", 2, Date.parse("2026-10-25T20:00:00+08:00")) }).sessionId)
      .toBe("relationship-session:message-2");
  });
});
