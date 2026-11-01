// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/src/shared/db/schema";
import { loadRelationshipSourceLedger } from "@/src/modules/character-network/repositories/relationship-source-ledger";
import { toRelationshipDomainLedger } from "@/src/modules/character-network/repositories/to-relationship-domain-ledger";
import { admitRelationshipCommit, replayAcceptedRelationship, type RelationshipCandidate } from "@/src/modules/character-network/domain/relationship-state";

const ownerId = "00000000-0000-4000-8000-000000000091";
const otherOwner = "00000000-0000-4000-8000-000000000092";
const characterId = "10000000-0000-4000-8000-000000000091";
const newerCharacter = "10000000-0000-4000-8000-000000000092";
const otherCharacter = "10000000-0000-4000-8000-000000000093";
const identityId = "20000000-0000-4000-8000-000000000091";
const otherIdentity = "20000000-0000-4000-8000-000000000092";
const conversationId = "30000000-0000-4000-8000-000000000091";
const scope = { ownerId, identityId, epoch: "epoch-1" };

describe("authoritative relationship source receipts", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  beforeEach(async () => {
    client = new PGlite();
    // Minimal real column types and ownership FKs; official reply-source table is the actual migration.
    // This suite deliberately does not claim production RLS coverage.
    await client.exec(`
      create table profiles(id uuid primary key);
      create table characters(id uuid primary key, stable_key text not null, character_version integer not null);
      create table character_identities(id uuid primary key, stable_key text not null, current_character_id uuid not null references characters(id));
      create table conversations(id uuid primary key, user_id uuid not null references profiles(id), character_id uuid not null references characters(id), identity_id uuid references character_identities(id), status text not null default 'active');
      create table messages(id uuid primary key, user_id uuid not null references profiles(id), conversation_id uuid not null references conversations(id), character_id uuid references characters(id), identity_id uuid references character_identities(id), client_message_id text not null, generation_id text, role text not null, status text not null, source_type text not null default 'conversation', reply_to_message_id uuid, completed_at timestamptz, created_at timestamptz not null default now());
      create role authenticated nologin;
      create role anon nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    await client.exec((await readFile(path.join(process.cwd(), "drizzle/0047_conversation_reply_sources.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));
    database = drizzle(client, { schema });
    await client.exec(`
      insert into profiles values ('${ownerId}'),('${otherOwner}');
      insert into characters values ('${characterId}','lucia',3),('${newerCharacter}','lucia',4),('${otherCharacter}','mateo',1);
      insert into character_identities values ('${identityId}','lucia','${newerCharacter}'),('${otherIdentity}','mateo','${otherCharacter}');
      insert into conversations(id,user_id,character_id,identity_id) values ('${conversationId}','${ownerId}','${characterId}','${identityId}');
    `);
  });
  afterEach(async () => { await client.close(); });

  async function batch(status: "completed" | "streaming" | "cancelled" = "completed", reuseUsers?: string[], userCount = 2) {
    const users = reuseUsers ?? Array.from({ length: userCount }, () => randomUUID());
    for (const id of reuseUsers ? [] : users) {
      await client.query("insert into messages(id,user_id,conversation_id,character_id,identity_id,client_message_id,generation_id,role,status,completed_at) values($1::uuid,$2,$3,$4,$5,$1::uuid::text,null,'user','completed',now())", [id, ownerId, conversationId, characterId, identityId]);
    }
    const assistant = randomUUID(), generation = randomUUID();
    await client.query("insert into messages(id,user_id,conversation_id,character_id,identity_id,client_message_id,generation_id,role,status,reply_to_message_id,completed_at) values($1,$2,$3,$4,$5,$6,$7,'character',$8,$9,case when $10::boolean then clock_timestamp() else null end)", [assistant, ownerId, conversationId, characterId, identityId, `assistant-${generation}`, generation, status, users.at(-1), status === "completed"]);
    await database.insert(schema.conversationReplySources).values(users.map((id, position) => ({ assistantMessageId: assistant, userMessageId: id, userId: ownerId, conversationId, position })));
    return { assistant, users, generation };
  }
  function metadata(users: string[]) { return users.map((messageId, index) => ({ ...scope, messageId, sessionId: "session-1", episodeId: `episode-${index}` })); }

  it("loads official order and the assistant's historical revision instead of the current published pointer", async () => {
    const turn = await batch();
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata([...turn.users].reverse()) });
    expect(result.turns[0]).toMatchObject({ id: turn.assistant, generationId: turn.generation, userMessageIds: turn.users, characterVersion: 3, status: "completed" });
    expect(result.messages).toHaveLength(3);
    expect(result.messages.find((message) => message.id === turn.users[0])).toMatchObject({ role: "user", generationId: null, status: "completed" });
    expect(result.messages.every((message) => Number.isFinite(message.createdAtMs))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("content");
  });

  it("keeps one canonical user source across legitimate completed generations", async () => {
    const first = await batch();
    const second = await batch("completed", first.users);
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [second.assistant, first.assistant], sourceMetadata: metadata(first.users) });
    expect(result.turns).toHaveLength(2);
    expect(result.messages).toHaveLength(4);
    expect(new Set(result.messages.map((message) => message.id)).size).toBe(4);
    expect(result.turns.every((turn) => JSON.stringify(turn.userMessageIds) === JSON.stringify(first.users))).toBe(true);
  });

  it.each(["streaming", "cancelled"] as const)("retains %s receipts as nongrowth turns while preserving completed user sources", async (status) => {
    const turn = await batch(status);
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) });
    expect(result.turns[0]?.status).toBe(status === "streaming" ? "pending" : "failed");
    expect(result.messages.find((message) => message.id === turn.users[0])?.status).toBe("completed");
  });

  it.each(["owner", "identity", "metadata-epoch"])("rejects %s mismatch", async (mismatch) => {
    const turn = await batch();
    await expect(loadRelationshipSourceLedger(database, { scope: { ...scope, ...(mismatch === "owner" ? { ownerId: otherOwner } : mismatch === "identity" ? { identityId: otherIdentity } : {}) }, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users).map((item) => mismatch === "metadata-epoch" ? { ...item, epoch: "old" } : item) })).rejects.toThrow();
  });

  it("does not promote withdrawn users or cancelled old generations", async () => {
    const turn = await batch("cancelled");
    await database.update(schema.messages).set({ status: "withdrawn" }).where(eq(schema.messages.id, turn.users[0]!));
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) });
    expect(result.turns[0]?.status).toBe("failed");
    expect(result.messages.find((message) => message.id === turn.users[0])?.status).toBe("withdrawn");
  });

  it.each(["parent", "position", "source-owner", "source-conversation", "revision", "generation", "tombstone"])("rejects corrupted official provenance: %s", async (corruption) => {
    const turn = await batch();
    if (corruption === "parent") await database.update(schema.messages).set({ replyToMessageId: turn.users[0]! }).where(eq(schema.messages.id, turn.assistant));
    if (corruption === "position") await database.update(schema.conversationReplySources).set({ position: 3 }).where(eq(schema.conversationReplySources.userMessageId, turn.users[1]!));
    if (corruption === "source-owner") await database.update(schema.messages).set({ userId: otherOwner }).where(eq(schema.messages.id, turn.users[0]!));
    if (corruption === "source-conversation") {
      const otherConversation = randomUUID();
      await client.query("insert into conversations(id,user_id,character_id,identity_id) values($1,$2,$3,$4)", [otherConversation, ownerId, characterId, identityId]);
      await database.update(schema.messages).set({ conversationId: otherConversation }).where(eq(schema.messages.id, turn.users[0]!));
    }
    if (corruption === "revision") await database.update(schema.messages).set({ characterId: otherCharacter }).where(eq(schema.messages.id, turn.assistant));
    if (corruption === "generation") await database.update(schema.messages).set({ generationId: "different-generation" }).where(eq(schema.messages.id, turn.assistant));
    if (corruption === "tombstone") await database.update(schema.messages).set({ sourceType: "generation_tombstone", status: "cancelled" }).where(eq(schema.messages.id, turn.assistant));
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) })).rejects.toThrow();
  });

  it("works on an existing transaction and rejects missing metadata or duplicate requested IDs", async () => {
    const turn = await batch();
    await database.transaction(async (transaction) => {
      expect((await loadRelationshipSourceLedger(transaction, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) })).turns).toHaveLength(1);
    });
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: [] })).rejects.toThrow();
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant, turn.assistant], sourceMetadata: metadata(turn.users) })).rejects.toThrow();
  });

  it("uses official turn membership when a user retains the old generation audit value", async () => {
    const old = await batch("cancelled");
    const current = await batch("completed", old.users);
    await database.update(schema.messages).set({ generationId: old.generation }).where(eq(schema.messages.id, old.users[0]!));
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [old.assistant, current.assistant], sourceMetadata: metadata(old.users) });
    expect(result.messages.filter((message) => message.id === old.users[0])).toHaveLength(1);
    expect(result.messages.find((message) => message.id === old.users[0])?.generationId).toBe(old.generation);
    expect(result.turns.find((turn) => turn.id === current.assistant)).toMatchObject({ generationId: current.generation, status: "completed", userMessageIds: old.users });
    expect(result.turns.find((turn) => turn.id === old.assistant)?.status).toBe("failed");
  });

  it("marks a formerly completed turn nongrowth when any official source is withdrawn", async () => {
    const turn = await batch();
    await database.update(schema.messages).set({ status: "withdrawn" }).where(eq(schema.messages.id, turn.users[0]!));
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) });
    expect(result.turns[0]?.status).toBe("failed");
  });

  it("rejects a deleted source instead of fabricating the missing batch member", async () => {
    const turn = await batch();
    await database.delete(schema.messages).where(eq(schema.messages.id, turn.users[0]!));
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) })).rejects.toThrow();
  });

  it("requires an actual completion timestamp for a completed assistant", async () => {
    const turn = await batch();
    await database.update(schema.messages).set({ completedAt: null }).where(eq(schema.messages.id, turn.assistant));
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) })).rejects.toThrow();
  });

  it.each(["assistant", "user"])("rejects %s completion predating message creation", async (role) => {
    const turn = await batch();
    await database.update(schema.messages).set({ completedAt: new Date(0) }).where(eq(schema.messages.id, role === "assistant" ? turn.assistant : turn.users[0]!));
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) })).rejects.toThrow();
  });

  it("accepts a historical completed user without completedAt using official completed reply membership", async () => {
    const turn = await batch();
    await database.update(schema.messages).set({ completedAt: null }).where(eq(schema.messages.id, turn.users[0]!));
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) });
    expect(result.messages.find((message) => message.id === turn.users[0])?.completedAtMs).toBeNull();
    expect(result.turns[0]?.status).toBe("completed");
  });

  it("preserves all twenty official batch members without truncation", async () => {
    const turn = await batch("completed", undefined, 20);
    const result = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [turn.assistant], sourceMetadata: metadata(turn.users) });
    expect(result.turns[0]?.userMessageIds).toEqual(turn.users);
    expect(result.messages).toHaveLength(21);
  });

  it("integrates real shared-source receipts through projection and admission without growing friendship twice", async () => {
    const first = await batch();
    const second = await batch("completed", first.users);
    const normalized = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [first.assistant, second.assistant], sourceMetadata: metadata(first.users) });
    const ledger = toRelationshipDomainLedger(normalized);
    const candidates: RelationshipCandidate[] = [
      { kind: "voluntary_personal_anchor", sourceMessageIds: [first.users[0]!], semanticVerified: true, certainty: "supported" },
      { kind: "mutual_conversation_welcome", sourceMessageIds: [first.users[1]!], semanticVerified: true, certainty: "explicit" },
    ];
    const initial = admitRelationshipCommit({ scope, ledger, acceptedReceipts: [], boundaryRevision: 0, capabilities: { romance: false }, commit: { ...scope, mode: "completed", sequence: 1, turnId: first.assistant, generationId: first.generation, expectedBoundaryRevision: 0, candidates } });
    expect(initial?.state.familiarity).toBe("getting_to_know_you");
    expect(initial).not.toBeNull();
    const duplicate = admitRelationshipCommit({ scope, ledger, acceptedReceipts: [initial!.receipt], boundaryRevision: initial!.state.boundaryRevision, capabilities: { romance: false }, commit: { ...scope, mode: "completed", sequence: 2, turnId: second.assistant, generationId: second.generation, expectedBoundaryRevision: initial!.state.boundaryRevision, candidates } });
    expect(duplicate).toBeNull();
    const replay = replayAcceptedRelationship({ scope, ledger, acceptedReceipts: [initial!.receipt], boundaryRevision: initial!.state.boundaryRevision, capabilities: { romance: false } });
    expect(replay.familiarity).toBe("getting_to_know_you");
    expect(replay.evidence).toHaveLength(2);
    expect(new Set(ledger.messages.map((message) => message.id)).size).toBe(4);
  });

  it("retains an accepted guard after failed and physically deleted assistants without admitting a stale guard", async () => {
    const old = await batch("streaming");
    const load = async (assistantMessageIds: string[], retainedUserMessageIds?: string[]) => toRelationshipDomainLedger(await loadRelationshipSourceLedger(database, { scope, assistantMessageIds, retainedUserMessageIds, sourceMetadata: metadata(old.users) }));
    const commit = { ...scope, mode: "guard" as const, sequence: 1, turnId: old.assistant, generationId: old.generation, expectedBoundaryRevision: 0, candidates: [{ kind: "explicit_friend_boundary" as const, sourceMessageIds: [old.users[0]!], certainty: "explicit" as const, semanticVerified: true }] };
    const admitted = admitRelationshipCommit({ scope, ledger: await load([old.assistant]), acceptedReceipts: [], boundaryRevision: 0, capabilities: { romance: true }, commit });
    expect(admitted?.state.userRomanticIntent).toBe("friends_only");
    expect(admitted).not.toBeNull();
    await database.update(schema.messages).set({ status: "cancelled" }).where(eq(schema.messages.id, old.assistant));
    const current = await batch("completed", old.users);
    const ledger = await load([old.assistant, current.assistant]);
    const context = { scope, ledger, acceptedReceipts: [admitted!.receipt], boundaryRevision: admitted!.state.boundaryRevision, capabilities: { romance: true } };
    expect(replayAcceptedRelationship(context).userRomanticIntent).toBe("friends_only");
    expect(admitRelationshipCommit({ ...context, commit: { ...commit, sequence: 2, expectedBoundaryRevision: context.boundaryRevision } })).toBeNull();
    await database.delete(schema.messages).where(eq(schema.messages.id, old.assistant));
    await database.delete(schema.messages).where(eq(schema.messages.id, current.assistant));
    const retained = await load([], old.users);
    expect(retained.turns).toEqual([]);
    expect(replayAcceptedRelationship({ ...context, ledger: retained }).userRomanticIntent).toBe("friends_only");
    expect(admitRelationshipCommit({ ...context, ledger: retained, commit: { ...commit, sequence: 2, expectedBoundaryRevision: context.boundaryRevision } })).toBeNull();
    await database.delete(schema.messages).where(eq(schema.messages.id, old.users[0]!));
    const deleted = await loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [], retainedUserMessageIds: old.users, sourceMetadata: metadata(old.users) });
    expect(deleted.missingRetainedUserMessageIds).toEqual([old.users[0]]);
    expect(deleted.sourceMetadata.some((item) => item.messageId === old.users[0])).toBe(false);
    expect(replayAcceptedRelationship({ ...context, ledger: toRelationshipDomainLedger(deleted) }).interactionSafety).toBe("reconfirmation_required");
  });

  it("rejects a foreign retained source and never treats an assistant as a retained user", async () => {
    const turn = await batch();
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [], retainedUserMessageIds: [turn.assistant], sourceMetadata: [{ ...scope, messageId: turn.assistant, sessionId: "s", episodeId: "e" }] })).rejects.toThrow();
    await database.update(schema.messages).set({ userId: otherOwner }).where(eq(schema.messages.id, turn.users[0]!));
    await expect(loadRelationshipSourceLedger(database, { scope, assistantMessageIds: [], retainedUserMessageIds: turn.users, sourceMetadata: metadata(turn.users) })).rejects.toThrow();
  });
});
