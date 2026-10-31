/**
 * Verifies relationship persistence against the configured PostgreSQL database.
 *
 * Every write is inside one transaction that is explicitly rolled back. The
 * script exercises the real repository, append-only/idempotency constraints and
 * compare-and-swap revision path without leaving relationship rows behind.
 *
 * Run:
 *   node --conditions=react-server --import tsx/esm scripts/verify-relationship-postgres.ts
 */
import { config as loadDotEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createDrizzleProactiveMessageRepository } from "../src/modules/conversation/repositories/drizzle-proactive-message-repository";
import { createDrizzlePrivacyRepository } from "../src/modules/privacy/repositories/drizzle-privacy-repository";
import { createRelationshipPersistenceRepository } from "../src/modules/character-network/repositories/relationship-persistence-repository";
import { tombstoneRelationshipSourcesForMessage } from "../src/modules/character-network/repositories/relationship-source-invalidation";
import { readRelationshipConversationContext } from "../src/modules/character-network/repositories/relationship-context";
import * as schema from "../src/shared/db/schema";

loadDotEnv({ path: ".env.local", quiet: true });
loadDotEnv({ path: ".env", quiet: true });

// The application URL is the configured hosted endpoint for this audit. A
// direct database endpoint may be firewalled from the current workstation.
const connection = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!connection) {
  console.log("no database connection string configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);
const results: string[] = [];
const check = (label: string, passed: boolean, detail = ""): void => {
  results.push(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const schemaObjects = [
  "relationship_heads",
  "relationship_events",
  "relationship_event_sources",
  "relationship_boundaries",
  "relationship_pending_sources",
] as const;
const schemaObjectLiterals = sql.raw(schemaObjects.map((name) => `'${name}'`).join(", "));

try {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in (${schemaObjectLiterals})
    order by table_name
  `);
  check("relationship tables exist", tables.length === schemaObjects.length, `${tables.length}/${schemaObjects.length}`);
  if (tables.length !== schemaObjects.length) throw new Error("RELATIONSHIP_TABLES_MISSING");

  const [pair] = await db.select({
    userId: schema.conversations.userId,
    identityId: schema.characterIdentities.id,
    conversationId: schema.conversations.id,
    characterId: schema.conversations.characterId,
  })
    .from(schema.conversations)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.conversations.userId))
    .innerJoin(schema.characterIdentities, eq(schema.characterIdentities.id, schema.conversations.identityId))
    .where(and(sql`${schema.conversations.identityId} is not null`, eq(schema.characterIdentities.stableKey, "lucia")))
    .limit(1);
  if (!pair) throw new Error("RELATIONSHIP_FIXTURE_PAIR_MISSING");

  const before = await db.execute<{ heads: number; events: number; pending: number; conversations: number; messages: number; candidates: number }>(sql`
    select
      (select count(*)::int from relationship_heads) as heads,
      (select count(*)::int from relationship_events) as events,
      (select count(*)::int from relationship_pending_sources) as pending,
      (select count(*)::int from conversations) as conversations,
      (select count(*)::int from messages) as messages,
      (select count(*)::int from proactive_message_candidates) as candidates
  `);
  const beforeCounts = before[0]!;

  await db.transaction(async (tx) => {
    const scope = { userId: pair.userId, identityId: pair.identityId } as const;
    const repository = createRelationshipPersistenceRepository(tx as never, tx as never);
    const head = await repository.ensureHead(scope);
    const sequence = head.controlRevision + 1;
    const eventId = randomUUID();
    const event = {
      id: eventId,
      sequence,
      idempotencyKey: `verify.relationship.${eventId}`,
      eventKind: "verify_relationship_event",
      certainty: "supported" as const,
      ruleVersion: "verify-v1",
      generationId: `verify-${eventId}`,
      characterVersion: 1,
      episodeKey: `verify-${eventId}`,
      payload: { verification: true },
      sources: [],
    };
    const inserted = await repository.appendAcceptedEvent(scope, head.id, event);
    check("append inserts an event", inserted.id === eventId && inserted.sequence === sequence);

    const sourceMessageId = randomUUID();
    await tx.insert(schema.messages).values({
      id: sourceMessageId,
      userId: pair.userId,
      conversationId: pair.conversationId,
      characterId: pair.characterId,
      identityId: pair.identityId,
      clientMessageId: `verify.relationship.${sourceMessageId}`,
      generationId: `verify-generation-${sourceMessageId}`,
      role: "user",
      status: "completed",
      sourceType: "conversation",
      content: "Mensaje de verificación; se revocará dentro de la transacción.",
      completedAt: new Date(),
    });
    await tx.insert(schema.relationshipEventSources).values({ eventId, messageId: sourceMessageId, sourceRole: "user", position: 0 });
    const tombstoned = await tombstoneRelationshipSourcesForMessage(tx as never, { userMessageId: sourceMessageId });
    const repeatedTombstone = await tombstoneRelationshipSourcesForMessage(tx as never, { userMessageId: sourceMessageId });
    check("source tombstone is idempotent", tombstoned === 1 && repeatedTombstone === 0);
    await tx.delete(schema.messages).where(eq(schema.messages.id, sourceMessageId));
    const [deletedSource] = await tx.select({ messageId: schema.relationshipEventSources.messageId, tombstoned: schema.relationshipEventSources.tombstoned })
      .from(schema.relationshipEventSources).where(eq(schema.relationshipEventSources.eventId, eventId));
    check("deleting the source message preserves a tombstoned source", deletedSource?.messageId === null && deletedSource.tombstoned === true);

    const duplicate = await repository.appendAcceptedEvent(scope, head.id, event);
    check("same idempotency key returns the original event", duplicate.id === eventId);

    try {
      await repository.appendAcceptedEvent(scope, head.id, { ...event, id: randomUUID(), eventKind: "verify_conflicting_event", turnId: undefined });
      check("conflicting idempotency payload is rejected", false);
    } catch (error) {
      check("conflicting idempotency payload is rejected", error instanceof Error && error.message === "RELATIONSHIP_EVENT_CONFLICT", String(error));
    }

    const current = await repository.readHead(scope);
    if (!current) throw new Error("RELATIONSHIP_HEAD_MISSING_AFTER_APPEND");
    const advanced = await repository.compareAndSwapRevision({ scope, headId: current.id, expected: current.controlRevision, next: current.controlRevision + 1 });
    check("CAS advances the revision", advanced.controlRevision === current.controlRevision + 1);

    try {
      await repository.compareAndSwapRevision({ scope, headId: current.id, expected: current.controlRevision, next: current.controlRevision + 1 });
      check("stale CAS is rejected", false);
    } catch (error) {
      check("stale CAS is rejected", error instanceof Error && error.message === "RELATIONSHIP_HEAD_REVISION_CONFLICT", String(error));
    }

    // Exercise the same replay reader used by conversation runtime. Each
    // event has a completed user/assistant turn, an independent episode, and
    // an official reply-source membership row. The source tombstone below is
    // deliberately applied before the second read so the projection must
    // recompute from live provenance rather than trust the event rows alone.
    const replayTurns = [
      { kind: "voluntary_personal_anchor", episode: "verify-replay-episode-1" },
      { kind: "mutual_conversation_welcome", episode: "verify-replay-episode-2" },
      { kind: "user_continuity_return", episode: "verify-replay-episode-3" },
    ] as const;
    const replaySources: Array<{ userMessageId: string; assistantMessageId: string; generationId: string; eventId: string }> = [];
    for (const [index, replayTurn] of replayTurns.entries()) {
      const userMessageId = randomUUID();
      const assistantMessageId = randomUUID();
      const generationId = `verify-replay-generation-${assistantMessageId}`;
      const eventId = randomUUID();
      await tx.insert(schema.messages).values([
        {
          id: userMessageId,
          userId: pair.userId,
          conversationId: pair.conversationId,
          characterId: pair.characterId,
          identityId: pair.identityId,
          clientMessageId: `verify-replay-user-${userMessageId}`,
          generationId: null,
          role: "user",
          status: "completed",
          sourceType: "conversation",
          content: `Mensaje de replay ${index + 1}.`,
          completedAt: new Date(),
        },
        {
          id: assistantMessageId,
          userId: pair.userId,
          conversationId: pair.conversationId,
          characterId: pair.characterId,
          identityId: pair.identityId,
          clientMessageId: `verify-replay-assistant-${assistantMessageId}`,
          generationId,
          role: "character",
          status: "completed",
          sourceType: "conversation",
          content: `Respuesta de replay ${index + 1}.`,
          completedAt: new Date(),
        },
      ]);
      await tx.insert(schema.conversationReplySources).values({
        assistantMessageId,
        userMessageId,
        userId: pair.userId,
        conversationId: pair.conversationId,
        position: 0,
      });
      const currentHead = await repository.readHead(scope);
      if (!currentHead) throw new Error("RELATIONSHIP_HEAD_MISSING_FOR_REPLAY");
      const insertedReplay = await repository.appendAcceptedEvent(scope, currentHead.id, {
        id: eventId,
        sequence: currentHead.controlRevision + 1,
        idempotencyKey: `verify.relationship.replay.${eventId}`,
        eventKind: replayTurn.kind,
        certainty: replayTurn.kind === "voluntary_personal_anchor" ? "supported" : "explicit",
        ruleVersion: "verify-replay-v1",
        generationId,
        turnId: assistantMessageId,
        characterVersion: 1,
        episodeKey: replayTurn.episode,
        payload: index === 2 ? { relatedSourceMessageIds: [replaySources[0]!.userMessageId] } : {},
        sources: [{ messageId: userMessageId, sourceRole: "user", position: 0 }],
      });
      replaySources.push({ userMessageId, assistantMessageId, generationId, eventId: insertedReplay.id });
    }
    const replayBefore = await readRelationshipConversationContext(tx as never, { userId: pair.userId, identityId: pair.identityId });
    check("relationship replay reaches familiar from three live episodes", replayBefore?.relationshipStage === "familiar", replayBefore?.relationshipStage ?? "null");
    const withdrawnReplaySource = replaySources[0]!;
    const withdrawnCount = await tombstoneRelationshipSourcesForMessage(tx as never, { userMessageId: withdrawnReplaySource.userMessageId });
    check("replay source withdrawal marks one live source", withdrawnCount === 1);
    const replayAfter = await readRelationshipConversationContext(tx as never, { userId: pair.userId, identityId: pair.identityId });
    check("relationship replay drops stage after source withdrawal", replayAfter?.relationshipStage === "new_contact", replayAfter?.relationshipStage ?? "null");

    const proactive = createDrizzleProactiveMessageRepository(tx as never);
    const proactiveGeneration = `verify-proactive-${randomUUID()}`;
    const candidate = await proactive.createCandidate({
      userId: pair.userId,
      conversationId: pair.conversationId,
      sourceType: "daily_share",
      dedupeKey: `verify-proactive-${proactiveGeneration}`,
      generationId: proactiveGeneration,
      notBefore: new Date(),
    });
    check("proactive candidate starts generating", candidate.status === "generating");
    const proactiveMessageId = randomUUID();
    const completed = await proactive.completeCandidate({ userId: pair.userId, candidateId: candidate.id, messageId: proactiveMessageId, generationId: proactiveGeneration, content: "Mensaje proactivo de verificación." });
    check("proactive candidate completes with a message", completed.candidate.status === "generated" && completed.message.id === proactiveMessageId);
    const repeatedCompletion = await proactive.completeCandidate({ userId: pair.userId, candidateId: candidate.id, messageId: randomUUID(), generationId: proactiveGeneration, content: "Debe devolverse el mensaje existente." });
    check("proactive completion is idempotent", repeatedCompletion.message.id === proactiveMessageId);

    const retryGeneration = `verify-proactive-retry-${randomUUID()}`;
    const retryDedupeKey = `verify-proactive-retry-${retryGeneration}`;
    const retryCandidate = await proactive.createCandidate({
      userId: pair.userId,
      conversationId: pair.conversationId,
      sourceType: "daily_share",
      dedupeKey: retryDedupeKey,
      generationId: `${retryGeneration}-first`,
      notBefore: new Date(),
    });
    await proactive.failCandidate({ userId: pair.userId, candidateId: retryCandidate.id, errorCode: "provider-timeout" });
    const retried = await proactive.createCandidate({
      userId: pair.userId,
      conversationId: pair.conversationId,
      sourceType: "daily_share",
      dedupeKey: retryDedupeKey,
      generationId: retryGeneration,
      notBefore: new Date(),
    });
    check("failed proactive candidate reopens only with a new generation", retried.id === retryCandidate.id && retried.status === "generating" && retried.generationId === retryGeneration);
    try {
      await proactive.completeCandidate({ userId: pair.userId, candidateId: retried.id, messageId: randomUUID(), generationId: `${retryGeneration}-first`, content: "Stale proactive candidate." });
      check("stale proactive completion is rejected", false);
    } catch (error) {
      check("stale proactive completion is rejected", error instanceof Error && error.message === "PROACTIVE_GENERATION_CONFLICT", String(error));
    }
    const retryCompleted = await proactive.completeCandidate({ userId: pair.userId, candidateId: retried.id, messageId: randomUUID(), generationId: retryGeneration, content: "Retry proactivo verificado." });
    check("current proactive retry completes", retryCompleted.candidate.status === "generated" && retryCompleted.message.generationId === retryGeneration);

    const boundaryHead = await repository.readHead(scope);
    if (!boundaryHead) throw new Error("RELATIONSHIP_HEAD_MISSING_FOR_PROACTIVE_BOUNDARY");
    await tx.insert(schema.relationshipBoundaries).values({
      headId: boundaryHead.id,
      userId: pair.userId,
      identityId: pair.identityId,
      scope: "proactive",
      target: "all",
      status: "active",
      revision: boundaryHead.controlRevision,
      idempotencyKey: `verify-proactive-boundary-${randomUUID()}`,
    });
    const blockedCandidate = await proactive.createCandidate({
      userId: pair.userId,
      conversationId: pair.conversationId,
      sourceType: "daily_share",
      dedupeKey: `verify-proactive-boundary-${randomUUID()}`,
      generationId: `verify-proactive-boundary-${randomUUID()}`,
      notBefore: new Date(),
    });
    try {
      await proactive.completeCandidate({ userId: pair.userId, candidateId: blockedCandidate.id, messageId: randomUUID(), generationId: blockedCandidate.generationId, content: "No debe cruzar el límite." });
      check("persisted proactive boundary blocks completion", false);
    } catch (error) {
      check("persisted proactive boundary blocks completion", error instanceof Error && error.message === "PROACTIVE_BOUNDARY", String(error));
    }

    const privacy = createDrizzlePrivacyRepository(tx as never);
    const exported = await privacy.readAccountExport(pair.userId, { perCategory: 10, conversations: 10, messages: 25 });
    check("account export returns a scoped snapshot", exported.account !== null && exported.messages.rows.every((row) => typeof row.content === "string") && !("providerCalls" in exported));
    const cleared = await privacy.clearAccountBusinessData(pair.userId);
    check("account business clear keeps the profile tombstone", cleared.alreadyDeleted === false);
    const [profileAfterClear] = await tx.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.id, pair.userId));
    check("account business clear preserves the profile row for retry", profileAfterClear?.id === pair.userId);
    const deletion = await privacy.deleteCharacterData(pair.userId, "lucia");
    check("privacy deletion removes the Lucía character data in one transaction", deletion.characterKey === "lucia" && deletion.conversationsDeleted >= 1);
    const remainingConversations = await tx.select({ id: schema.conversations.id }).from(schema.conversations)
      .where(and(eq(schema.conversations.userId, pair.userId), eq(schema.conversations.identityId, pair.identityId)));
    const remainingHeads = await tx.select({ id: schema.relationshipHeads.id }).from(schema.relationshipHeads)
      .where(and(eq(schema.relationshipHeads.userId, pair.userId), eq(schema.relationshipHeads.identityId, pair.identityId)));
    check("privacy deletion clears conversations and relationship heads", remainingConversations.length === 0 && remainingHeads.length === 0);

    tx.rollback();
  }).catch((error: unknown) => {
    const name = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (!/rollback/i.test(name)) throw error;
  });

  const after = await db.execute<{ heads: number; events: number; pending: number; conversations: number; messages: number; candidates: number }>(sql`
    select
      (select count(*)::int from relationship_heads) as heads,
      (select count(*)::int from relationship_events) as events,
      (select count(*)::int from relationship_pending_sources) as pending,
      (select count(*)::int from conversations) as conversations,
      (select count(*)::int from messages) as messages,
      (select count(*)::int from proactive_message_candidates) as candidates
  `);
  const afterCounts = after[0]!;
  check("rollback leaves relationship row counts unchanged", JSON.stringify(afterCounts) === JSON.stringify(beforeCounts), `${JSON.stringify(beforeCounts)} -> ${JSON.stringify(afterCounts)}`);

  const policies = await db.execute<{ relname: string; relrowsecurity: boolean; policy_count: number }>(sql`
    select c.relname, c.relrowsecurity, count(p.policyname)::int as policy_count
    from pg_class c
    left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
    where c.relnamespace = 'public'::regnamespace and c.relname in (${schemaObjectLiterals})
    group by c.relname, c.relrowsecurity
    order by c.relname
  `);
  check("relationship tables have RLS and policies", policies.length === schemaObjects.length && policies.every((row) => row.relrowsecurity && row.policy_count > 0), `${policies.length}/${schemaObjects.length}`);
} catch (error) {
  const detail = error instanceof Error
    ? `${error.message}${"code" in error && typeof error.code === "string" ? ` [${error.code}]` : ""}`
    : String(error);
  check("verification completed", false, detail);
} finally {
  for (const line of results) console.log(line);
  const failures = results.filter((line) => line.startsWith("FAIL")).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  await client.end({ timeout: 5 });
  process.exitCode = failures === 0 ? 0 : 1;
}

