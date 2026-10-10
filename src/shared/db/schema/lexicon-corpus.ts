import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, reviewStatusEnum, updatedAt, type JsonObject } from "./common";
import { profiles } from "./users";

export const lexemes = pgTable("lexemes", {
  id: uuid("id").defaultRandom().primaryKey(),
  lemma: text("lemma").notNull(),
  normalizedLemma: text("normalized_lemma").notNull(),
  language: text("language").default("es").notNull(),
  partOfSpeech: text("part_of_speech"),
  lemmaStatus: text("lemma_status").default("pending").notNull(),
  meaningZh: text("meaning_zh"),
  cefr: text("cefr"),
  region: text("region"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("lexemes_language_normalized_pos_uidx").on(table.language, table.normalizedLemma, table.partOfSpeech),
  index("lexemes_normalized_lemma_idx").on(table.normalizedLemma),
  check("lexemes_language_check", sql`${table.language} = 'es'`),
  check("lexemes_status_check", sql`${table.lemmaStatus} in ('verified', 'pending')`),
]);

export const lexemeForms = pgTable("lexeme_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  lexemeId: uuid("lexeme_id").notNull().references(() => lexemes.id, { onDelete: "cascade" }),
  surface: text("surface").notNull(),
  normalizedSurface: text("normalized_surface").notNull(),
  formKind: text("form_kind").default("observed").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("lexeme_forms_lexeme_surface_uidx").on(table.lexemeId, table.normalizedSurface),
  index("lexeme_forms_normalized_surface_idx").on(table.normalizedSurface),
]);

export const phraseEntries = pgTable("phrase_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  expression: text("expression").notNull(),
  normalizedExpression: text("normalized_expression").notNull(),
  meaningZh: text("meaning_zh"),
  pragmaticPurpose: text("pragmatic_purpose"),
  register: text("register"),
  region: text("region"),
  cefr: text("cefr"),
  ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "cascade" }),
  reviewStatus: reviewStatusEnum("review_status").default("pending").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("phrase_entries_public_expression_uidx").on(table.normalizedExpression).where(sql`${table.ownerUserId} is null`),
  index("phrase_entries_owner_status_idx").on(table.ownerUserId, table.reviewStatus),
]);

export const phraseVariants = pgTable("phrase_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  phraseEntryId: uuid("phrase_entry_id").notNull().references(() => phraseEntries.id, { onDelete: "cascade" }),
  expression: text("expression").notNull(),
  normalizedExpression: text("normalized_expression").notNull(),
  slotPattern: text("slot_pattern"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("phrase_variants_entry_expression_uidx").on(table.phraseEntryId, table.normalizedExpression),
]);

export const corpusOccurrences = pgTable("corpus_occurrences", {
  id: uuid("id").defaultRandom().primaryKey(),
  lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
  phraseEntryId: uuid("phrase_entry_id").references(() => phraseEntries.id, { onDelete: "cascade" }),
  documentKind: text("document_kind").notNull(),
  documentStableKey: text("document_stable_key").notNull(),
  documentVersion: integer("document_version").notNull(),
  sourcePosition: jsonb("source_position").notNull(),
  surfaceText: text("surface_text").notNull(),
  normalizedText: text("normalized_text").notNull(),
  contextBefore: text("context_before").default("").notNull(),
  contextAfter: text("context_after").default("").notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceKind: text("source_kind").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("corpus_occurrences_lexeme_document_position_uidx").on(table.lexemeId, table.documentKind, table.documentStableKey, table.documentVersion, table.normalizedText, table.sourcePosition),
  index("corpus_occurrences_lexeme_idx").on(table.lexemeId, table.documentKind, table.documentStableKey),
  index("corpus_occurrences_phrase_idx").on(table.phraseEntryId, table.documentKind, table.documentStableKey),
  check("corpus_occurrences_one_entry_check", sql`((${table.lexemeId} is not null)::int + (${table.phraseEntryId} is not null)::int) = 1`),
  check("corpus_occurrences_version_positive_check", sql`${table.documentVersion} > 0`),
  check("corpus_occurrences_document_kind_check", sql`${table.documentKind} in ('article', 'media')`),
]);

export const userLexicalIntents = pgTable("user_lexical_intents", {
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  entryKind: text("entry_kind").notNull(),
  entryId: uuid("entry_id").notNull(),
  intent: text("intent").notNull(),
  revision: integer("revision").default(1).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("user_lexical_intents_user_entry_uidx").on(table.userId, table.entryKind, table.entryId),
  index("user_lexical_intents_user_intent_idx").on(table.userId, table.intent),
  check("user_lexical_intents_kind_check", sql`${table.entryKind} in ('lexeme', 'phrase')`),
  check("user_lexical_intents_value_check", sql`${table.intent} in ('familiar', 'revisit', 'ignore')`),
  check("user_lexical_intents_revision_check", sql`${table.revision} > 0`),
]);

export const lexicalAssessmentItems = pgTable("lexical_assessment_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentKey: text("assessment_key").notNull(),
  version: integer("version").default(1).notNull(),
  entryKind: text("entry_kind").notNull(),
  entryId: uuid("entry_id"),
  promptType: text("prompt_type").notNull(),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  acceptedAnswers: jsonb("accepted_answers").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  sourceReference: jsonb("source_reference").notNull(),
  skillKey: text("skill_key").notNull(),
  contentVersion: integer("content_version").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status").default("published").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("lexical_assessment_items_key_version_uidx").on(table.assessmentKey, table.version),
  index("lexical_assessment_items_visibility_idx").on(table.ownerUserId, table.status),
  check("lexical_assessment_items_version_positive_check", sql`${table.version} > 0`),
  check("lexical_assessment_items_kind_check", sql`${table.entryKind} in ('lexeme', 'phrase')`),
  check("lexical_assessment_items_prompt_type_check", sql`${table.promptType} in ('choice', 'judgement', 'cloze', 'recall')`),
  check("lexical_assessment_items_skill_check", sql`${table.skillKey} like 'lexical.%'`),
  check("lexical_assessment_items_content_version_check", sql`${table.contentVersion} > 0`),
  check("lexical_assessment_items_status_check", sql`${table.status} in ('published', 'archived')`),
]);

export const lexicalAssessmentAttempts = pgTable("lexical_assessment_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  assessmentItemId: uuid("assessment_item_id").notNull().references(() => lexicalAssessmentItems.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  answer: text("answer").notNull(),
  normalizedAnswer: text("normalized_answer").notNull(),
  score: integer("score").notNull(),
  passed: boolean("passed").notNull(),
  inputMode: text("input_mode").default("typing").notNull(),
  algorithmVersion: text("algorithm_version").notNull(),
  contentVersion: integer("content_version").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("lexical_assessment_attempts_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
  index("lexical_assessment_attempts_user_item_idx").on(table.userId, table.assessmentItemId, table.createdAt),
  check("lexical_assessment_attempts_score_check", sql`${table.score} in (0, 1)`),
  check("lexical_assessment_attempts_input_mode_check", sql`${table.inputMode} = 'typing'`),
  check("lexical_assessment_attempts_content_version_check", sql`${table.contentVersion} > 0`),
]);

/**
 * Extraction candidates awaiting review and owner approval (ADR-0011).
 *
 * A row here is a *proposal* that a surface form in published content should
 * become a `lexeme` or a `phrase_entry`. These rows are deliberately separate
 * from the corpus tables: nothing in this table creates a lexeme, a phrase
 * entry or a corpus occurrence, and only an `approved` row may be handed to
 * `indexContentVersion()`. That is why `lemma_status` is derived from `status`
 * rather than stored — the corpus can never receive `verified` by accident.
 *
 * `document_version` is part of the identity, so a later content edit cannot
 * silently move an approved candidate onto different text.
 */
export const lexiconCandidates = pgTable("lexicon_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  candidateKind: text("candidate_kind").notNull(),
  documentKind: text("document_kind").notNull(),
  documentStableKey: text("document_stable_key").notNull(),
  documentVersion: integer("document_version").notNull(),
  segmentIndex: integer("segment_index").notNull(),
  sourceText: text("source_text").notNull(),
  normalizedText: text("normalized_text").notNull(),
  lemma: text("lemma"),
  partOfSpeech: text("part_of_speech"),
  meaningZh: text("meaning_zh"),
  contextBefore: text("context_before").default("").notNull(),
  contextAfter: text("context_after").default("").notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceKind: text("source_kind").notNull(),
  provider: text("provider").notNull(),
  modelVersion: text("model_version"),
  confidence: integer("confidence"),
  status: text("status").default("discovered").notNull(),
  revision: integer("revision").default(1).notNull(),
  /** Review records: [{dimension, outcome, reviewerReference, reviewedAt}]. */
  reviews: jsonb("reviews").$type<JsonObject[]>().default(sql`'[]'::jsonb`).notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  rejectedReason: text("rejected_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  // Re-extraction must not collide with an existing candidate for the same span.
  uniqueIndex("lexicon_candidates_identity_uidx").on(
    table.candidateKind,
    table.documentKind,
    table.documentStableKey,
    table.documentVersion,
    table.segmentIndex,
    table.normalizedText,
  ),
  index("lexicon_candidates_status_idx").on(table.status, table.createdAt),
  index("lexicon_candidates_document_idx").on(table.documentKind, table.documentStableKey, table.documentVersion),
  check("lexicon_candidates_kind_check", sql`${table.candidateKind} in ('lexeme', 'phrase')`),
  check(
    "lexicon_candidates_status_check",
    sql`${table.status} in ('discovered', 'review_submitted', 'review_ready', 'approved', 'rejected')`,
  ),
  check("lexicon_candidates_document_kind_check", sql`${table.documentKind} in ('article', 'media')`),
  check("lexicon_candidates_version_positive_check", sql`${table.documentVersion} > 0`),
  check("lexicon_candidates_segment_index_check", sql`${table.segmentIndex} >= 0`),
  check("lexicon_candidates_revision_positive_check", sql`${table.revision} > 0`),
  check("lexicon_candidates_confidence_check", sql`${table.confidence} is null or ${table.confidence} between 0 and 100`),
  // An approved row must record who approved it and when.
  check(
    "lexicon_candidates_approved_audit_check",
    sql`${table.status} <> 'approved' or (${table.approvedBy} is not null and ${table.approvedAt} is not null)`,
  ),
]);

export type LexemeRow = typeof lexemes.$inferSelect;
export type PhraseEntryRow = typeof phraseEntries.$inferSelect;
export type CorpusOccurrenceRow = typeof corpusOccurrences.$inferSelect;
export type LexicalAssessmentItemRow = typeof lexicalAssessmentItems.$inferSelect;
export type LexicalAssessmentAttemptRow = typeof lexicalAssessmentAttempts.$inferSelect;
export type LexiconCandidateRow = typeof lexiconCandidates.$inferSelect;
