import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

import { buildKwic, evaluateLexicalAnswer, buildLexicalEvidenceDraft, normalizeCorpusQuery, type SourcePosition } from "../domain";
import { recordLexicalEvidenceWithinTransaction } from "@/src/modules/evidence/application";
import { createDrizzleEvidenceRepository } from "@/src/modules/evidence/repositories";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import { normalizeLexeme } from "../domain";
import type { LexicalIntent } from "../schemas/lexicon";
import type { AssessmentAttemptInput, AssessmentAttemptResult, AssessmentItem, CorpusItem, CorpusQuery, LexiconCorpusRepository, PhraseItem, VocabularyItem } from "./lexicon-corpus-repository";

export class LexicalIntentConflictError extends Error {
  readonly code = "LEXICAL_INTENT_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "LexicalIntentConflictError";
  }
}

export class LexicalAssessmentConflictError extends Error {
  readonly code = "LEXICAL_ASSESSMENT_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "LexicalAssessmentConflictError";
  }
}

export class LexicalAssessmentNotFoundError extends Error {
  readonly code = "LEXICAL_ASSESSMENT_NOT_FOUND" as const;

  constructor(message = "Assessment is not available.") {
    super(message);
    this.name = "LexicalAssessmentNotFoundError";
  }
}

function assessmentItem(row: typeof schema.lexicalAssessmentItems.$inferSelect): AssessmentItem {
  return {
    id: row.id,
    assessmentKey: row.assessmentKey,
    version: row.version,
    entryKind: row.entryKind as "lexeme" | "phrase",
    entryId: row.entryId,
    promptType: row.promptType as AssessmentItem["promptType"],
    prompt: row.prompt,
    options: row.options ?? [],
    acceptedAnswers: row.acceptedAnswers ?? [],
    sourceReference: row.sourceReference as Record<string, unknown>,
    skillKey: row.skillKey,
    contentVersion: row.contentVersion,
  };
}

function intentMap(rows: readonly typeof schema.userLexicalIntents.$inferSelect[]): Map<string, { intent: LexicalIntent; revision: number }> {
  return new Map(rows.map((row) => [`${row.entryKind}:${row.entryId}`, { intent: row.intent as LexicalIntent, revision: row.revision }]));
}

export function createDrizzleLexiconCorpusRepository(database: Database): LexiconCorpusRepository {
  return {
    async listVocabulary(userId, query) {
      const search = query.search ? `%${query.search}%` : undefined;
      const where = search
        ? or(ilike(schema.lexemes.lemma, search), ilike(schema.lexemeForms.surface, search), ilike(schema.lexemeForms.normalizedSurface, search))
        : undefined;
      const [idRows, countRows, intents] = await Promise.all([
        database.select({ id: schema.lexemes.id })
          .from(schema.lexemes)
          .leftJoin(schema.lexemeForms, eq(schema.lexemeForms.lexemeId, schema.lexemes.id))
          .where(where)
          .groupBy(schema.lexemes.id)
          .orderBy(asc(schema.lexemes.normalizedLemma))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        database.select({ count: sql<number>`count(distinct ${schema.lexemes.id})` })
          .from(schema.lexemes)
          .leftJoin(schema.lexemeForms, eq(schema.lexemeForms.lexemeId, schema.lexemes.id))
          .where(where),
        userId ? database.select().from(schema.userLexicalIntents).where(eq(schema.userLexicalIntents.userId, userId)) : Promise.resolve([]),
      ]);
      const ids = idRows.map((row) => row.id);
      const [lexemeRows, formRows, occurrenceRows] = ids.length === 0
        ? [[], [], []] as const
        : await Promise.all([
          database.select().from(schema.lexemes).where(inArray(schema.lexemes.id, ids)),
          database.select({ lexemeId: schema.lexemeForms.lexemeId, surface: schema.lexemeForms.surface }).from(schema.lexemeForms).where(inArray(schema.lexemeForms.lexemeId, ids)),
          database.select({ lexemeId: schema.corpusOccurrences.lexemeId, count: sql<number>`count(*)` }).from(schema.corpusOccurrences).where(inArray(schema.corpusOccurrences.lexemeId, ids)).groupBy(schema.corpusOccurrences.lexemeId),
        ]);
      const intentByKey = intentMap(intents);
      const byId = new Map<string, VocabularyItem>(lexemeRows.map((lexeme) => [lexeme.id, {
        id: lexeme.id, lemma: lexeme.lemma, normalizedLemma: lexeme.normalizedLemma,
        partOfSpeech: lexeme.partOfSpeech, lemmaStatus: lexeme.lemmaStatus as "verified" | "pending", meaningZh: lexeme.meaningZh,
        forms: [] as string[], occurrenceCount: 0, intent: null, revision: 1,
      } satisfies VocabularyItem]));
      for (const row of formRows) {
        const current = byId.get(row.lexemeId);
        if (!current) continue;
        byId.set(row.lexemeId, { ...current, forms: [...current.forms, row.surface] });
      }
      for (const row of occurrenceRows) {
        if (!row.lexemeId) continue;
        const current = byId.get(row.lexemeId);
        if (!current) continue;
        byId.set(row.lexemeId, { ...current, occurrenceCount: Number(row.count ?? 0) });
      }
      for (const item of byId.values()) {
        const intent = intentByKey.get(`lexeme:${item.id}`);
        byId.set(item.id, { ...item, intent: intent?.intent ?? null, revision: intent?.revision ?? 1 });
      }
      const items = [...byId.values()].filter((item) => !query.intent || item.intent === query.intent);
      return { items, page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.count ?? 0) };
    },

    async listPhrases(userId, query) {
      const visible = userId
        ? or(and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved")), eq(schema.phraseEntries.ownerUserId, userId))
        : and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved"));
      const where = query.search ? and(visible, ilike(schema.phraseEntries.expression, `%${query.search}%`)) : visible;
      const [idRows, countRows, intents] = await Promise.all([
        database.select({ id: schema.phraseEntries.id })
          .from(schema.phraseEntries)
          .where(where)
          .orderBy(desc(schema.phraseEntries.updatedAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        database.select({ count: sql<number>`count(*)` }).from(schema.phraseEntries).where(where),
        userId ? database.select().from(schema.userLexicalIntents).where(eq(schema.userLexicalIntents.userId, userId)) : Promise.resolve([]),
      ]);
      const ids = idRows.map((row) => row.id);
      const [phraseRows, variantRows, occurrenceRows] = ids.length === 0
        ? [[], [], []] as const
        : await Promise.all([
          database.select().from(schema.phraseEntries).where(inArray(schema.phraseEntries.id, ids)),
          database.select({ phraseEntryId: schema.phraseVariants.phraseEntryId, expression: schema.phraseVariants.expression }).from(schema.phraseVariants).where(inArray(schema.phraseVariants.phraseEntryId, ids)),
          database.select({ phraseEntryId: schema.corpusOccurrences.phraseEntryId, count: sql<number>`count(*)` }).from(schema.corpusOccurrences).where(inArray(schema.corpusOccurrences.phraseEntryId, ids)).groupBy(schema.corpusOccurrences.phraseEntryId),
        ]);
      const intentByKey = intentMap(intents);
      const byId = new Map<string, PhraseItem>(phraseRows.map((phrase) => [phrase.id, {
        id: phrase.id, expression: phrase.expression, normalizedExpression: phrase.normalizedExpression, meaningZh: phrase.meaningZh,
        pragmaticPurpose: phrase.pragmaticPurpose, register: phrase.register, region: phrase.region, cefr: phrase.cefr,
        variants: [] as string[], occurrenceCount: 0, intent: null, revision: 1,
      } satisfies PhraseItem]));
      for (const row of variantRows) {
        const current = byId.get(row.phraseEntryId);
        if (!current) continue;
        byId.set(row.phraseEntryId, { ...current, variants: [...current.variants, row.expression] });
      }
      for (const row of occurrenceRows) {
        if (!row.phraseEntryId) continue;
        const current = byId.get(row.phraseEntryId);
        if (!current) continue;
        byId.set(row.phraseEntryId, { ...current, occurrenceCount: Number(row.count ?? 0) });
      }
      for (const item of byId.values()) {
        const intent = intentByKey.get(`phrase:${item.id}`);
        byId.set(item.id, { ...item, intent: intent?.intent ?? null, revision: intent?.revision ?? 1 });
      }
      const items = [...byId.values()].filter((item) => !query.intent || item.intent === query.intent);
      return { items, page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.count ?? 0) };
    },

    async setIntent(userId, entryKind, entryId, intent, expectedRevision) {
      return database.transaction(async (transaction) => {
        if (entryKind === "lexeme") {
          const [entry] = await transaction.select({ id: schema.lexemes.id }).from(schema.lexemes).where(eq(schema.lexemes.id, entryId)).limit(1);
          if (!entry) throw new LexicalIntentConflictError("Lexical entry is not available.");
        } else {
          const [entry] = await transaction.select({ id: schema.phraseEntries.id }).from(schema.phraseEntries).where(and(eq(schema.phraseEntries.id, entryId), or(and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved")), eq(schema.phraseEntries.ownerUserId, userId)))).limit(1);
          if (!entry) throw new LexicalIntentConflictError("Lexical entry is not available.");
        }
        const [existing] = await transaction.select().from(schema.userLexicalIntents).where(and(eq(schema.userLexicalIntents.userId, userId), eq(schema.userLexicalIntents.entryKind, entryKind), eq(schema.userLexicalIntents.entryId, entryId))).limit(1).for("update");
        if (expectedRevision !== undefined && existing && existing.revision !== expectedRevision) throw new LexicalIntentConflictError("Lexical intent revision changed.");
        const revision = (existing?.revision ?? 0) + 1;
        await transaction.insert(schema.userLexicalIntents).values({ userId, entryKind, entryId, intent, revision }).onConflictDoUpdate({ target: [schema.userLexicalIntents.userId, schema.userLexicalIntents.entryKind, schema.userLexicalIntents.entryId], set: { intent, revision, updatedAt: new Date() } });
        return { entryKind, entryId, intent, revision };
      });
    },

    async indexLexeme(input, sourceTitle, sourceKind) {
      const lexeme = normalizeLexeme({ surface: input.lemma, lemma: input.lemma, partOfSpeech: input.partOfSpeech });
      return database.transaction(async (transaction) => {
        await transaction.insert(schema.lexemes).values({ lemma: lexeme.lemma, normalizedLemma: input.normalizedLemma, language: "es", partOfSpeech: lexeme.partOfSpeech, lemmaStatus: input.lemmaStatus, meaningZh: input.meaningZh ?? null }).onConflictDoNothing();
        const [entry] = await transaction.select().from(schema.lexemes).where(and(eq(schema.lexemes.language, "es"), eq(schema.lexemes.normalizedLemma, input.normalizedLemma), input.partOfSpeech ? eq(schema.lexemes.partOfSpeech, input.partOfSpeech) : sql`${schema.lexemes.partOfSpeech} is null`)).limit(1);
        if (!entry) throw new Error("LEXEME_WRITE_FAILED");
        await transaction.insert(schema.lexemeForms).values({ lexemeId: entry.id, surface: input.form, normalizedSurface: input.normalizedForm }).onConflictDoNothing();
        await transaction.insert(schema.corpusOccurrences).values({ lexemeId: entry.id, documentKind: input.reference.document.kind, documentStableKey: input.reference.document.stableKey, documentVersion: input.reference.document.version, sourcePosition: input.reference.position, surfaceText: input.form, normalizedText: input.normalizedForm, contextBefore: input.reference.contextBefore, contextAfter: input.reference.contextAfter, sourceTitle, sourceKind }).onConflictDoNothing();
        return entry.id;
      });
    },

    async indexPhrase(input, sourceTitle, sourceKind) {
      return database.transaction(async (transaction) => {
        await transaction.insert(schema.phraseEntries).values({ expression: input.expression, normalizedExpression: input.normalizedExpression, meaningZh: input.meaningZh ?? null, pragmaticPurpose: input.pragmaticPurpose ?? null, register: input.register ?? null, region: input.region ?? null, cefr: input.cefr ?? null, ownerUserId: input.ownerUserId ?? null, reviewStatus: input.ownerUserId ? "pending" : "approved" }).onConflictDoNothing();
        const [entry] = await transaction.select().from(schema.phraseEntries).where(and(eq(schema.phraseEntries.normalizedExpression, input.normalizedExpression), input.ownerUserId ? eq(schema.phraseEntries.ownerUserId, input.ownerUserId) : isNull(schema.phraseEntries.ownerUserId))).limit(1);
        if (!entry) throw new Error("PHRASE_WRITE_FAILED");
        if (input.variant && input.normalizedVariant) await transaction.insert(schema.phraseVariants).values({ phraseEntryId: entry.id, expression: input.variant, normalizedExpression: input.normalizedVariant }).onConflictDoNothing();
        await transaction.insert(schema.corpusOccurrences).values({ phraseEntryId: entry.id, documentKind: input.reference.document.kind, documentStableKey: input.reference.document.stableKey, documentVersion: input.reference.document.version, sourcePosition: input.reference.position, surfaceText: input.expression, normalizedText: input.normalizedExpression, contextBefore: input.reference.contextBefore, contextAfter: input.reference.contextAfter, sourceTitle, sourceKind, ownerUserId: input.ownerUserId ?? null }).onConflictDoNothing();
        return entry.id;
      });
    },

    async searchCorpus(userId, query: CorpusQuery) {
      const tokens = normalizeCorpusQuery(query.query);
      if (tokens.length === 0) return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
      const publicArticle = sql`exists (select 1 from ${schema.articles} a inner join ${schema.articleVersions} av on av.article_id = a.id where a.stable_key = ${schema.corpusOccurrences.documentStableKey} and av.version = ${schema.corpusOccurrences.documentVersion} and av.status = 'published')`;
      const publicMedia = sql`exists (select 1 from ${schema.mediaItems} mi inner join ${schema.mediaVersions} mv on mv.media_item_id = mi.id where mi.stable_key = ${schema.corpusOccurrences.documentStableKey} and mv.version = ${schema.corpusOccurrences.documentVersion} and mv.status = 'published' and mv.copyright_status = 'cleared')`;
      const visible = userId
        ? or(eq(schema.corpusOccurrences.ownerUserId, userId), and(isNull(schema.corpusOccurrences.ownerUserId), or(and(eq(schema.corpusOccurrences.documentKind, "article"), publicArticle), and(eq(schema.corpusOccurrences.documentKind, "media"), publicMedia))))
        : and(isNull(schema.corpusOccurrences.ownerUserId), or(and(eq(schema.corpusOccurrences.documentKind, "article"), publicArticle), and(eq(schema.corpusOccurrences.documentKind, "media"), publicMedia)));
      const where = and(
        visible,
        ...tokens.map((token) => ilike(schema.corpusOccurrences.normalizedText, `%${token}%`)),
        query.documentKind ? eq(schema.corpusOccurrences.documentKind, query.documentKind) : undefined,
        query.sourceKind ? eq(schema.corpusOccurrences.sourceKind, query.sourceKind) : undefined,
        query.stableKey ? eq(schema.corpusOccurrences.documentStableKey, query.stableKey) : undefined,
      );
      const [rows, countRows] = await Promise.all([
        database.select().from(schema.corpusOccurrences).where(where).orderBy(desc(schema.corpusOccurrences.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        database.select({ count: sql<number>`count(*)` }).from(schema.corpusOccurrences).where(where),
      ]);
      const items: CorpusItem[] = rows.map((row) => buildKwic({
        surfaceText: row.surfaceText,
        contextBefore: row.contextBefore,
        contextAfter: row.contextAfter,
        sourceTitle: row.sourceTitle,
        sourceKind: row.sourceKind,
        documentKind: row.documentKind as "article" | "media",
        documentStableKey: row.documentStableKey,
        documentVersion: row.documentVersion,
        sourcePosition: row.sourcePosition as SourcePosition,
      }) as CorpusItem).map((item, index) => ({ ...item, entryKind: rows[index]!.lexemeId ? "lexeme" : "phrase", entryId: (rows[index]!.lexemeId ?? rows[index]!.phraseEntryId)!, surfaceText: rows[index]!.surfaceText }));
      return { items, page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.count ?? 0) };
    },

    async getAssessment(userId, assessmentKey) {
      const visibility = userId
        ? and(eq(schema.lexicalAssessmentItems.status, "published"), or(isNull(schema.lexicalAssessmentItems.ownerUserId), eq(schema.lexicalAssessmentItems.ownerUserId, userId)))
        : and(isNull(schema.lexicalAssessmentItems.ownerUserId), eq(schema.lexicalAssessmentItems.status, "published"));
      const [row] = await database.select().from(schema.lexicalAssessmentItems).where(and(eq(schema.lexicalAssessmentItems.assessmentKey, assessmentKey), visibility)).orderBy(desc(schema.lexicalAssessmentItems.version)).limit(1);
      return row ? assessmentItem(row) : null;
    },

    async submitAssessment(userId, assessmentKey, input: AssessmentAttemptInput): Promise<AssessmentAttemptResult> {
      return database.transaction(async (transaction) => {
        const visibility = and(eq(schema.lexicalAssessmentItems.status, "published"), or(isNull(schema.lexicalAssessmentItems.ownerUserId), eq(schema.lexicalAssessmentItems.ownerUserId, userId)));
        const [row] = await transaction.select().from(schema.lexicalAssessmentItems).where(and(eq(schema.lexicalAssessmentItems.assessmentKey, assessmentKey), visibility)).orderBy(desc(schema.lexicalAssessmentItems.version)).limit(1);
        if (!row) throw new LexicalAssessmentNotFoundError();
        const [existing] = await transaction.select().from(schema.lexicalAssessmentAttempts).where(and(eq(schema.lexicalAssessmentAttempts.userId, userId), eq(schema.lexicalAssessmentAttempts.idempotencyKey, input.idempotencyKey))).limit(1);
        if (existing) {
          if (existing.requestHash !== input.requestHash || existing.assessmentItemId !== row.id) throw new LexicalAssessmentConflictError("Assessment attempt idempotency key was reused.");
          return { attemptId: existing.id, assessmentKey, version: row.version, answer: existing.answer, passed: existing.passed, score: existing.score as 0 | 1, normalizedAnswer: existing.normalizedAnswer, duplicate: true, evidence: "duplicate" };
        }
        const item = assessmentItem(row);
        const result = evaluateLexicalAnswer(item, input.answer);
        const [attempt] = await transaction.insert(schema.lexicalAssessmentAttempts).values({ userId, assessmentItemId: row.id, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, answer: input.answer, normalizedAnswer: result.normalizedAnswer, score: result.score, passed: result.passed, inputMode: "typing", algorithmVersion: "lexical-assessment-v1", contentVersion: row.contentVersion }).returning({ id: schema.lexicalAssessmentAttempts.id });
        if (!attempt) throw new Error("LEXICAL_ASSESSMENT_ATTEMPT_WRITE_FAILED");
        const evidence = buildLexicalEvidenceDraft({ userId, assessmentAttemptId: attempt.id, idempotencyKey: `lexical:${input.idempotencyKey}`, assessmentItemId: row.id, contentVersion: row.contentVersion, skillKey: row.skillKey, score: result.score, confidence: result.passed ? 0.9 : 0.75, occurredAt: new Date() });
        const evidenceResult = await recordLexicalEvidenceWithinTransaction(createDrizzleEvidenceRepository(transaction), { event: evidence });
        return { attemptId: attempt.id, assessmentKey, version: row.version, answer: input.answer, passed: result.passed, score: result.score, normalizedAnswer: result.normalizedAnswer, duplicate: false, evidence: evidenceResult.status };
      });
    },
  };
}
