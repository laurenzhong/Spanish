import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { buildKwic, discoveryContext, evaluateLexicalAnswer, buildLexicalEvidenceDraft, extractContentExpression, extractContentExpressions, normalizeCorpusQuery, normalizeSpanishSurface, tokenizeSpanish, type ContentDiscoveryExpression, type ContentDiscoverySegment, type SourcePosition } from "../domain";
import { searchContentFrequencyWords } from "../domain/frequency-word-list";
import { FREQUENCY_CONTEXT_EDGE_CHARS, FREQUENCY_CONTEXT_MAX_CHARS, loadFormFrequencyRows, type FormFrequencyRow } from "./corpus-form-frequency";
import { recordLexicalEvidenceWithinTransaction } from "@/src/modules/evidence/application";
import { createDrizzleEvidenceRepository } from "@/src/modules/evidence/repositories";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import { normalizeLexeme } from "../domain";
import type { LexicalIntent, LexicalIntentFilter } from "../schemas/lexicon";
import type { AssessmentAttemptInput, AssessmentAttemptResult, AssessmentItem, CorpusBrowseQuery, CorpusCluster, CorpusClusterContext, CorpusExample, CorpusItem, CorpusQuery, LexiconCorpusRepository, PagedResult, PhraseItem, VocabularyItem } from "./lexicon-corpus-repository";
import type { PhraseQuery } from "../schemas/lexicon";

const FREQUENCY_TTL_MS = 10 * 60 * 1_000;
// The discovery path is a bounded read-through for databases that have
// published content but have not finished the reviewed lexicon indexing job.
// It must paint quickly; the formal phrase index remains the source of truth
// once it has rows.
const CONTENT_DISCOVERY_SEGMENT_LIMIT = 600;

type DiscoveryFilters = Readonly<{ documentKind?: "article" | "media"; contentKind?: "article" | "video" | "podcast" }>;

function discoverySourcePosition(segment: ContentDiscoverySegment): SourcePosition {
  return segment.documentKind === "article"
    ? { kind: "text", paragraphId: String(segment.segmentIndex), segmentIndex: segment.segmentIndex }
    : { kind: "media", startMs: segment.startMs ?? 0, endMs: segment.endMs ?? Math.max(1, (segment.startMs ?? 0) + 1), segmentIndex: segment.segmentIndex };
}

function discoveryId(normalizedExpression: string, segment: ContentDiscoverySegment): string {
  return `content:${segment.documentKind}:${segment.documentStableKey}:${segment.documentVersion}:${segment.segmentIndex}:${normalizedExpression}`;
}

function discoveryExpressionMatches(expression: ContentDiscoveryExpression, query: string | undefined): boolean {
  const tokens = normalizeCorpusQuery(query ?? "");
  if (tokens.length === 0) return true;
  const haystack = expression.normalizedExpression.split(" ");
  return tokens.every((token, index) => haystack[index] === token);
}

function toDiscoveryContext(expression: ContentDiscoveryExpression): CorpusClusterContext {
  const context = discoveryContext(expression);
  const segment = expression.segment;
  const position = discoverySourcePosition(segment);
  return {
    ...buildKwic({
      surfaceText: expression.expression,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
      documentKind: segment.documentKind,
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      sourcePosition: position,
    }),
    entryKind: "phrase",
    entryId: discoveryId(expression.normalizedExpression, segment),
    surfaceText: expression.expression,
    contentKind: segment.contentKind,
    isContentDiscovery: true,
  };
}

function toDiscoveryPhrase(expression: ContentDiscoveryExpression): PhraseItem {
  const context = discoveryContext(expression);
  const segment = expression.segment;
  const position = discoverySourcePosition(segment);
  const id = discoveryId(expression.normalizedExpression, segment);
  return {
    id,
    expression: expression.expression,
    normalizedExpression: expression.normalizedExpression,
    scope: "public",
    meaningZh: null,
    pragmaticPurpose: null,
    register: null,
    region: null,
    cefr: null,
    variants: [],
    occurrenceCount: 1,
    representativeOccurrence: {
      ...buildKwic({
        surfaceText: expression.expression,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter,
        sourceTitle: segment.sourceTitle,
        sourceKind: segment.sourceKind,
        documentKind: segment.documentKind,
        documentStableKey: segment.documentStableKey,
        documentVersion: segment.documentVersion,
        sourcePosition: position,
      }),
      entryKind: "phrase",
      entryId: id,
      surfaceText: expression.expression,
    },
    intent: null,
    revision: 1,
    isContentDiscovery: true,
  };
}

// The frequency shelf shows one usage line per word form. Contexts are clipped
// around the form itself so a detail panel can never render an unbounded
// sentence pair, while the form always stays whole enough to be recognisable.
// The two limits are defined in `corpus-form-frequency.ts`, because the SQL that
// clips the example on the way out of the database has to respect them too: a
// window that did not would change what this function renders.

/**
 * Occurrence counts for the reference-list forms, keyed by the accent-folded
 * form the token index uses, plus one real example of each form in the wild.
 *
 * The live form of this query is an aggregate over every published segment
 * (109,211 texts on the real corpus). Measured against the real database with
 * `scripts/verify-frequency-shelf.ts` (fresh process each run, before/after
 * alternating so both share the same load):
 *
 * | query                                              | cold            |
 * |----------------------------------------------------|-----------------|
 * | group every form, filter in Node (previous)        | 4548/4273/4052 ms |
 * | fold + filter in SQL, one fold per token           | 2844/2790/2866 ms |
 *
 * Variants probed in a single process (relative to each other, not to the runs
 * above — the first query of a process also warms the buffer cache, so these
 * flatter whatever ran second): filter in SQL with `translate` twice per token
 * 2394 ms; fold once per token 2332 ms; media and article branches in parallel
 * 2206 ms; a 7.9k-value `IN (...)` placeholder list 3284 ms; tokenising without
 * folding or grouping 1435 ms; reading the segments without tokenising 1014 ms.
 *
 * Those floors are the corpus scan itself, so the counts are now **materialised**
 * into `lexicon_form_frequencies` and refreshed by
 * `scripts/refresh-frequency-forms.ts`. The SQL that defines what "visible"
 * means lives in one place, `corpus-form-frequency.ts`: the live query below and
 * the refresh that fills the table are built from the same `source_texts` CTE,
 * so they physically cannot drift apart. Which source serves a cold load, the
 * 36-hour staleness cap that reverts to the live scan, and the fallback for an
 * empty or never-refreshed table are documented there too.
 */
type CorpusFormCounts = ReadonlyMap<string, number>;

/**
 * One real, visible segment: the document title and the text the form occurs
 * in. Picked with `min(...)` inside the same group-by as the counts, which is
 * arbitrary but deterministic; the alternative — preferring the richest context
 * — means carrying whole long segments (some are 7.8k characters) through the
 * aggregate and measured 14 183 ms cold against 3 123 ms for this one.
 */
type FrequencyExample = Readonly<{ title: string; text: string }>;

/**
 * The two facts the shelf needs from the corpus, produced by one scan and cached
 * together: how often each form occurs, and one example of it in the wild. The
 * examples are rows of the same `source_texts` set the counts are counted from,
 * so a source cannot be visible to one and hidden from the other.
 */
type CorpusFrequencySnapshot = Readonly<{
  counts: CorpusFormCounts;
  examples: ReadonlyMap<string, FrequencyExample>;
}>;

let frequencySnapshotCache: Readonly<{ loadedAt: number; snapshot: CorpusFrequencySnapshot }> | null = null;
let frequencySnapshotInFlight: Promise<CorpusFrequencySnapshot> | null = null;

async function computeCorpusFrequencySnapshot(database: Database): Promise<CorpusFrequencySnapshot> {
  // Both facts come from one source — the materialised table when it is fresh,
  // the live corpus scan otherwise — so a caller cannot end up with counts from
  // one visibility rule and examples from another. `corpus-form-frequency.ts`
  // owns that choice and the single `source_texts` CTE behind it.
  const perfStarted = Date.now();
  let rows: readonly FormFrequencyRow[];
  try {
    rows = (await loadFormFrequencyRows(database)).rows;
  } catch (error) {
    // A failure here must keep the page's "unavailable" state rather than render
    // every badge as a fabricated zero.
    const cause = (error as { cause?: unknown }).cause;
    console.log(`[frequency] corpus snapshot failed after ${Date.now() - perfStarted} ms: ${String(cause ?? error).slice(0, 300)}`);
    throw error;
  }
  const counts = new Map<string, number>();
  const examples = new Map<string, FrequencyExample>();
  for (const row of rows) {
    // Folding again in JS is a no-op for these rows and keeps the SQL fold and
    // `normalizeSpanishSurface` from drifting apart unnoticed.
    const normalized = normalizeSpanishSurface(row.word);
    if (normalized.length < 2) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + Number(row.n ?? 0));
    // `min(array[text, title])` compares the text first, so the aggregate settles
    // early instead of carrying whichever long segment happens to win, and the two
    // fields stay one value with no separator the text could itself contain. It is
    // loaded with the counts, so the example is a row of the same visible set --
    // and the materialised table stores exactly the pair this aggregate picked.
    const text = row.example?.[0];
    const title = row.example?.[1];
    if (typeof text === "string" && typeof title === "string") examples.set(normalized, { title, text });
  }
  return { counts, examples };
}

async function loadCorpusFrequencySnapshot(database: Database): Promise<CorpusFrequencySnapshot> {
  const now = Date.now();
  if (frequencySnapshotCache && now - frequencySnapshotCache.loadedAt < FREQUENCY_TTL_MS) return frequencySnapshotCache.snapshot;
  if (frequencySnapshotInFlight) return frequencySnapshotInFlight;
  const pending = computeCorpusFrequencySnapshot(database)
    .then((snapshot) => {
      frequencySnapshotCache = { loadedAt: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      frequencySnapshotInFlight = null;
    });
  frequencySnapshotInFlight = pending;
  return pending;
}

/** One visible occurrence of a frequency form, reduced to what the detail panel needs. */
type FrequencyOccurrence = Readonly<{
  surfaceText: string;
  contextBefore: string;
  contextAfter: string;
  sourceTitle: string;
}>;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Collapse runs of whitespace but keep the boundary spaces the source had. */
function normalizeContextText(value: string): string {
  return value.replace(/\s+/gu, " ");
}

/**
 * The three parts come from one real sentence, so a space is only inserted where
 * the sentence must have had a word boundary: a side that begins or ends with a
 * word character was separated from the keyword by something, while punctuation
 * and the boundary spaces of a slice must stay attached (`decir.`, not
 * `decir .`). Occurrence rows written without boundary spaces still get them.
 */
function joinContext(left: string, keyword: string, right: string): string {
  const withLeft = /[\p{L}\p{N}]$/u.test(left) ? `${left} ` : left;
  const withRight = /^[\p{L}\p{N}]/u.test(right) ? ` ${right}` : right;
  return `${withLeft}${keyword}${withRight}`;
}

/**
 * Bounded keyword-in-context string for the frequency shelf. The surface form
 * is kept in the middle; only the surrounding segments are clipped, and the
 * total length never exceeds {@link FREQUENCY_CONTEXT_MAX_CHARS}.
 *
 * Exported with {@link locateFrequencyExample} so a verification run and the
 * tests can render the *same* context from a SQL-clipped example and from the
 * whole segment and assert the two are identical, character for character. That
 * equality is what lets `corpus-form-frequency.ts` clip in the query without
 * changing a single pixel of the shelf.
 */
export function buildFrequencyContext(occurrence: FrequencyOccurrence): string {
  const keyword = collapseWhitespace(occurrence.surfaceText);
  const left = normalizeContextText(occurrence.contextBefore);
  const right = normalizeContextText(occurrence.contextAfter);
  const joined = joinContext(left, keyword, right).trim();
  if (joined.length <= FREQUENCY_CONTEXT_MAX_CHARS) return joined;
  const clippedLeft = left.length > FREQUENCY_CONTEXT_EDGE_CHARS ? `…${left.slice(-FREQUENCY_CONTEXT_EDGE_CHARS)}` : left;
  const clippedRight = right.length > FREQUENCY_CONTEXT_EDGE_CHARS ? `${right.slice(0, FREQUENCY_CONTEXT_EDGE_CHARS)}…` : right;
  const keywordBudget = Math.max(16, FREQUENCY_CONTEXT_MAX_CHARS - clippedLeft.length - clippedRight.length - 2);
  const clippedKeyword = keyword.length > keywordBudget ? `${keyword.slice(0, keywordBudget - 1)}…` : keyword;
  return joinContext(clippedLeft, clippedKeyword, clippedRight).trim();
}

/**
 * Recover the occurrence the SQL sample was picked for. The aggregate carries
 * the whole segment text and its title because `regexp_split_to_table` cannot
 * report offsets; `tokenizeSpanish` already knows them, so the position is found
 * here instead of being recomputed in SQL. Returns `null` — never a guess — when
 * the text holds no token folding to the requested form.
 *
 * A text clipped by {@link clippedFrequencyExample} is deliberately a window
 * around that same first token, so this function locates it unchanged; the
 * export exists for the equality proof described on
 * {@link buildFrequencyContext}.
 */
export function locateFrequencyExample(example: FrequencyExample, normalizedWord: string): FrequencyOccurrence | null {
  const token = tokenizeSpanish(example.text).find((candidate) => candidate.normalized === normalizedWord);
  if (!token) return null;
  return {
    surfaceText: token.surface,
    contextBefore: example.text.slice(0, token.start),
    contextAfter: example.text.slice(token.end),
    sourceTitle: example.title,
  };
}

/** Letters, marks and internal apostrophes only; safe to use inside a regex. */
function corpusWordPattern(word: string): string {
  const cleaned = word.replace(/[^\p{L}\p{M}\u2019']/gu, "");
  return `\\m${cleaned}\\M`;
}

const EXAMPLE_CACHE_TTL_MS = 60 * 60 * 1_000;
const EXAMPLE_CACHE_LIMIT = 500;
const exampleCache = new Map<string, Readonly<{ cachedAt: number; value: CorpusExample | null }>>();

async function findCorpusExample(database: Database, word: string): Promise<CorpusExample | null> {
  const cacheKey = normalizeSpanishSurface(word);
  const cached = exampleCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < EXAMPLE_CACHE_TTL_MS) return cached.value;
  const value = await queryCorpusExample(database, word);
  if (exampleCache.size >= EXAMPLE_CACHE_LIMIT) {
    const oldest = [...exampleCache.entries()].sort((left, right) => left[1].cachedAt - right[1].cachedAt)[0];
    if (oldest) exampleCache.delete(oldest[0]);
  }
  exampleCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

async function queryCorpusExample(database: Database, word: string): Promise<CorpusExample | null> {
  const pattern = corpusWordPattern(word);
  if (pattern.length <= 4) return null;
  const [media] = await database
    .select({
      sentence: schema.mediaSegments.sourceText,
      translation: schema.mediaSegments.translation,
      title: schema.mediaVersions.title,
      stableKey: schema.mediaItems.stableKey,
      version: schema.mediaVersions.version,
      position: schema.mediaSegments.segmentIndex,
    })
    .from(schema.mediaSegments)
    .innerJoin(schema.mediaVersions, eq(schema.mediaSegments.mediaVersionId, schema.mediaVersions.id))
    .innerJoin(schema.mediaItems, eq(schema.mediaVersions.mediaItemId, schema.mediaItems.id))
    .where(and(
      eq(schema.mediaSegments.reviewStatus, "approved"),
      eq(schema.mediaVersions.status, "published"),
      eq(schema.mediaVersions.copyrightStatus, "cleared"),
      sql`${schema.mediaSegments.sourceText} ~* ${pattern}`,
      sql`${schema.mediaSegments.translation} is not null`,
    ))
    .limit(1);
  if (media) {
    return {
      word,
      sentence: media.sentence,
      translation: media.translation ?? null,
      sourceTitle: media.title,
      documentKind: "media",
      documentStableKey: media.stableKey,
      documentVersion: media.version,
      position: media.position,
    };
  }
  const [article] = await database
    .select({
      sentence: schema.articleSegments.sourceText,
      title: schema.articleVersions.title,
      stableKey: schema.articles.stableKey,
      version: schema.articleVersions.version,
      position: schema.articleSegments.position,
    })
    .from(schema.articleSegments)
    .innerJoin(schema.articleVersions, eq(schema.articleSegments.articleVersionId, schema.articleVersions.id))
    .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
    .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
    .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
    .where(and(
      eq(schema.articleVersions.status, "published"),
      eq(schema.articleSources.copyrightStatus, "cleared"),
      isNull(schema.userGeneratedArticles.id),
      sql`${schema.articleSegments.sourceText} ~* ${pattern}`,
    ))
    .limit(1);
  if (!article) return null;
  return {
    word,
    sentence: article.sentence,
    translation: null,
    sourceTitle: article.title,
    documentKind: "article",
    documentStableKey: article.stableKey,
    documentVersion: article.version,
    position: article.position,
  };
}

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

function intentFilter(userId: string | undefined, entryKind: "lexeme" | "phrase", entryId: typeof schema.lexemes.id | typeof schema.phraseEntries.id, intent: LexicalIntentFilter | undefined) {
  if (!intent) return undefined;
  if (!userId) return sql`false`;
  if (intent === "unmarked") {
    return sql`not exists (select 1 from ${schema.userLexicalIntents} uli where uli.user_id = ${userId} and uli.entry_kind = ${entryKind} and uli.entry_id = ${entryId})`;
  }
  return sql`exists (select 1 from ${schema.userLexicalIntents} uli where uli.user_id = ${userId} and uli.entry_kind = ${entryKind} and uli.entry_id = ${entryId} and uli.intent = ${intent})`;
}

function corpusVisibility(userId: string | undefined) {
  const publicArticle = sql`exists (
    select 1 from ${schema.articles} a
    inner join ${schema.articleVersions} av on av.article_id = a.id
    inner join ${schema.articleSources} src on src.id = av.source_id
    where a.stable_key = ${schema.corpusOccurrences.documentStableKey}
      and av.version = ${schema.corpusOccurrences.documentVersion}
      and av.status = 'published'
      and src.copyright_status = 'cleared'
      and not exists (select 1 from ${schema.userGeneratedArticles} generated where generated.article_version_id = av.id)
  )`;
  const ownGeneratedArticle = userId ? sql`exists (
    select 1 from ${schema.articles} a
    inner join ${schema.articleVersions} av on av.article_id = a.id
    inner join ${schema.articleSources} src on src.id = av.source_id
    inner join ${schema.userGeneratedArticles} generated on generated.article_version_id = av.id
    where a.stable_key = ${schema.corpusOccurrences.documentStableKey}
      and av.version = ${schema.corpusOccurrences.documentVersion}
      and av.status = 'published'
      and src.copyright_status = 'cleared'
      and generated.user_id = ${userId}
  )` : undefined;
  const publicMedia = sql`exists (select 1 from ${schema.mediaItems} mi inner join ${schema.mediaVersions} mv on mv.media_item_id = mi.id where mi.stable_key = ${schema.corpusOccurrences.documentStableKey} and mv.version = ${schema.corpusOccurrences.documentVersion} and mv.status = 'published' and mv.copyright_status = 'cleared')`;
  const publicSource = or(and(eq(schema.corpusOccurrences.documentKind, "article"), publicArticle), and(eq(schema.corpusOccurrences.documentKind, "media"), publicMedia));
  return userId
    ? or(
      and(isNull(schema.corpusOccurrences.ownerUserId), publicSource),
      and(eq(schema.corpusOccurrences.ownerUserId, userId), or(publicSource, and(eq(schema.corpusOccurrences.documentKind, "article"), ownGeneratedArticle))),
    )
    : and(isNull(schema.corpusOccurrences.ownerUserId), publicSource);
}

function phraseVisibility(userId: string | undefined) {
  return userId
    ? or(and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved")), eq(schema.phraseEntries.ownerUserId, userId))
    : and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved"));
}

async function listPublishedContentSegments(database: Database, filters: DiscoveryFilters = {}): Promise<readonly ContentDiscoverySegment[]> {
  const mediaKinds = filters.contentKind && filters.contentKind !== "article" ? [filters.contentKind] : ["video", "podcast"] as const;
  const mediaRows = filters.documentKind === "article" ? [] : (await Promise.all(
    mediaKinds.map((kind) => database.select({
    contentKind: schema.mediaItems.kind,
    documentStableKey: schema.mediaItems.stableKey,
    documentVersion: schema.mediaVersions.version,
    sourceText: schema.mediaSegments.sourceText,
    segmentIndex: schema.mediaSegments.segmentIndex,
    startMs: schema.mediaSegments.startMs,
    endMs: schema.mediaSegments.endMs,
    sourceTitle: schema.mediaVersions.title,
    sourceKind: schema.mediaVersions.sourceName,
    publishedAt: schema.mediaVersions.publishedAt,
  })
    .from(schema.mediaSegments)
    .innerJoin(schema.mediaVersions, eq(schema.mediaSegments.mediaVersionId, schema.mediaVersions.id))
    .innerJoin(schema.mediaItems, eq(schema.mediaVersions.mediaItemId, schema.mediaItems.id))
    .where(and(
      eq(schema.mediaSegments.reviewStatus, "approved"),
      eq(schema.mediaVersions.status, "published"),
      eq(schema.mediaVersions.copyrightStatus, "cleared"),
      eq(schema.mediaItems.kind, kind),
    ))
      .limit(CONTENT_DISCOVERY_SEGMENT_LIMIT)),
  )).flat();
  const articleRows = filters.documentKind === "media" || (filters.contentKind && filters.contentKind !== "article") ? [] : await database.select({
    documentStableKey: schema.articles.stableKey,
    documentVersion: schema.articleVersions.version,
    sourceText: schema.articleSegments.sourceText,
    segmentIndex: schema.articleSegments.position,
    sourceTitle: schema.articleVersions.title,
    publishedAt: schema.articleVersions.publishedAt,
  })
    .from(schema.articleSegments)
    .innerJoin(schema.articleVersions, eq(schema.articleSegments.articleVersionId, schema.articleVersions.id))
    .innerJoin(schema.articles, eq(schema.articleVersions.articleId, schema.articles.id))
    .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
    .leftJoin(schema.userGeneratedArticles, eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id))
    .where(and(
      eq(schema.articleVersions.status, "published"),
      eq(schema.articleSources.copyrightStatus, "cleared"),
      isNull(schema.userGeneratedArticles.id),
    ))
    .limit(CONTENT_DISCOVERY_SEGMENT_LIMIT);
  const segments: ContentDiscoverySegment[] = [
    ...mediaRows.map((row) => ({ ...row, documentKind: "media" as const, contentKind: row.contentKind as "video" | "podcast", sourceKind: row.sourceKind || row.contentKind, publishedAt: row.publishedAt ?? null })),
    ...articleRows.map((row) => ({ ...row, documentKind: "article" as const, contentKind: "article" as const, sourceKind: "article", publishedAt: row.publishedAt ?? null })),
  ];
  segments.sort((left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0) || left.documentStableKey.localeCompare(right.documentStableKey) || left.segmentIndex - right.segmentIndex);
  return segments;
}

async function listContentDiscoveryPhrases(database: Database, query: PhraseQuery): Promise<PagedResult<PhraseItem>> {
  if (query.intent || query.pragmaticPurpose || query.register || query.region || query.cefr) return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let segments: readonly ContentDiscoverySegment[];
  try {
    segments = await listPublishedContentSegments(database);
  } catch {
    // Older test fixtures and partially migrated local databases may not have
    // the published segment projections yet; keep the formal shelf empty
    // rather than turning a browse into a 500.
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  }
  const seen = new Set<string>();
  const expressions: ContentDiscoveryExpression[] = [];
  for (const segment of segments) {
    const expression = extractContentExpression(segment);
    if (!expression || !discoveryExpressionMatches(expression, query.search)) continue;
    if (seen.has(expression.normalizedExpression)) continue;
    seen.add(expression.normalizedExpression);
    expressions.push(expression);
  }
  const offset = (query.page - 1) * query.pageSize;
  return { items: expressions.slice(offset, offset + query.pageSize).map(toDiscoveryPhrase), page: query.page, pageSize: query.pageSize, total: expressions.length };
}

async function listContentDiscoveryClusters(database: Database, query: CorpusBrowseQuery): Promise<PagedResult<CorpusCluster>> {
  let segments: readonly ContentDiscoverySegment[];
  try {
    segments = await listPublishedContentSegments(database, { documentKind: query.documentKind, contentKind: query.contentKind });
  } catch {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  }
  const byExpression = new Map<string, ContentDiscoveryExpression[]>();
  for (const segment of segments) {
    const seenInSegment = new Set<string>();
    for (const expression of extractContentExpressions(segment).slice(0, 8)) {
      if (!discoveryExpressionMatches(expression, query.query) || seenInSegment.has(expression.normalizedExpression)) continue;
      seenInSegment.add(expression.normalizedExpression);
      const current = byExpression.get(expression.normalizedExpression) ?? [];
      current.push(expression);
      byExpression.set(expression.normalizedExpression, current);
    }
  }
  const ranked = [...byExpression.entries()].sort((left, right) => {
    const leftKinds = new Set(left[1].map((item) => item.segment.contentKind)).size;
    const rightKinds = new Set(right[1].map((item) => item.segment.contentKind)).size;
    return rightKinds - leftKinds || right[1].length - left[1].length || left[0].localeCompare(right[0]);
  });
  const offset = (query.page - 1) * query.pageSize;
  const items = ranked.slice(offset, offset + query.pageSize).map(([normalizedExpression, expressions]) => {
    const contexts: CorpusClusterContext[] = [];
    for (const kind of ["article", "video", "podcast"] as const) {
      for (const expression of expressions) {
        const duplicate = contexts.some((item) => item.contentKind === kind && item.document.stableKey === expression.segment.documentStableKey && item.location.segmentIndex === expression.segment.segmentIndex);
        if (expression.segment.contentKind !== kind || duplicate) continue;
        contexts.push(toDiscoveryContext(expression));
        if (contexts.filter((item) => item.contentKind === kind).length >= 3) break;
      }
    }
    const contentKinds = ["article", "video", "podcast"] as const;
    return {
      entryKind: "phrase" as const,
      entryId: `content:${normalizedExpression}`,
      expression: expressions[0]?.expression ?? normalizedExpression,
      meaningZh: null,
      pragmaticPurpose: null,
      contexts,
      contentKinds: contentKinds.filter((kind) => contexts.some((context) => context.contentKind === kind)),
      isContentDiscovery: true,
    } satisfies CorpusCluster;
  });
  return { items, page: query.page, pageSize: query.pageSize, total: ranked.length };
}

export function createDrizzleLexiconCorpusRepository(database: Database): LexiconCorpusRepository {
  return {
    async listFrequencyWords(query) {
      // The shelf is the committed reference word list with function words
      // removed, in reference-rank order; our corpus only supplies how often we
      // have seen the form and one visible example. Order is never recomputed
      // from our own counts — that is what put `que`/`los`/`por` at the top.
      const matched = searchContentFrequencyWords(query.search ?? "");
      const pageSlice = matched.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      // One cached read for the whole page: counts and examples are both facts
      // of the same snapshot, so a warm page costs no query at all and never one
      // query per word.
      const snapshot = await loadCorpusFrequencySnapshot(database);
      const pageItems = pageSlice.map((entry) => {
        const normalizedWord = normalizeSpanishSurface(entry.word);
        const example = snapshot.examples.get(normalizedWord);
        const occurrence = example ? locateFrequencyExample(example, normalizedWord) : null;
        return {
          id: `word:${normalizedWord}`,
          word: entry.word,
          normalizedWord,
          occurrenceCount: snapshot.counts.get(normalizedWord) ?? 0,
          context: occurrence ? buildFrequencyContext(occurrence) : null,
          sourceTitle: occurrence?.sourceTitle ?? null,
        };
      });
      return { items: pageItems, page: query.page, pageSize: query.pageSize, total: matched.length };
    },

    async readFrequencyWord(word) {
      // The form the caller asked about is the form the corpus was read by, so the
      // row is taken only when it really is that form: `casa` must not be answered
      // with `casas`, which the fold would otherwise allow.
      const normalizedWord = normalizeSpanishSurface(word);
      if (!normalizedWord) return null;
      // The same cached snapshot the page reads — not a second read path. The warm-up
      // at boot fills it, so a lookup costs no query, and the shelf and the lookup
      // cannot disagree about a word's count or excerpt.
      const snapshot = await loadCorpusFrequencySnapshot(database);
      if (!snapshot.counts.has(normalizedWord) && !snapshot.examples.has(normalizedWord)) return null;
      const example = snapshot.examples.get(normalizedWord);
      const occurrence = example ? locateFrequencyExample(example, normalizedWord) : null;
      return {
        id: `word:${normalizedWord}`,
        word: normalizedWord,
        normalizedWord,
        occurrenceCount: snapshot.counts.get(normalizedWord) ?? 0,
        context: occurrence ? buildFrequencyContext(occurrence) : null,
        sourceTitle: occurrence?.sourceTitle ?? null,
      };
    },

    async findCorpusExample(word) {
      return findCorpusExample(database, word);
    },

    async listVocabulary(userId, query) {
      const search = query.search ? `%${query.search}%` : undefined;
      const visibleOccurrence = corpusVisibility(userId);
      const where = and(
        sql`exists (select 1 from ${schema.corpusOccurrences} where ${schema.corpusOccurrences.lexemeId} = ${schema.lexemes.id} and ${visibleOccurrence})`,
        search ? or(ilike(schema.lexemes.lemma, search), ilike(schema.lexemeForms.surface, search), ilike(schema.lexemeForms.normalizedSurface, search)) : undefined,
        query.lemmaStatus ? eq(schema.lexemes.lemmaStatus, query.lemmaStatus) : undefined,
        intentFilter(userId, "lexeme", schema.lexemes.id, query.intent),
      );
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
          database.select({ lexemeId: schema.corpusOccurrences.lexemeId, count: sql<number>`count(*)` }).from(schema.corpusOccurrences).where(and(inArray(schema.corpusOccurrences.lexemeId, ids), visibleOccurrence)).groupBy(schema.corpusOccurrences.lexemeId),
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
      const items = [...byId.values()];
      return { items, page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.count ?? 0) };
    },

    async listPhrases(userId, query) {
      const visible = userId
        ? or(and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved")), eq(schema.phraseEntries.ownerUserId, userId))
        : and(isNull(schema.phraseEntries.ownerUserId), eq(schema.phraseEntries.reviewStatus, "approved"));
      const phraseSearch = query.search ? `%${query.search}%` : undefined;
      const visibleOccurrence = corpusVisibility(userId);
      const where = and(
        visible,
        sql`exists (select 1 from ${schema.corpusOccurrences} where ${schema.corpusOccurrences.phraseEntryId} = ${schema.phraseEntries.id} and ${visibleOccurrence})`,
        phraseSearch ? or(
          ilike(schema.phraseEntries.expression, phraseSearch),
          ilike(schema.phraseEntries.normalizedExpression, phraseSearch),
          sql`exists (select 1 from ${schema.phraseVariants} pv where pv.phrase_entry_id = ${schema.phraseEntries.id} and (pv.expression ilike ${phraseSearch} or pv.normalized_expression ilike ${phraseSearch}))`,
        ) : undefined,
        query.pragmaticPurpose ? ilike(schema.phraseEntries.pragmaticPurpose, query.pragmaticPurpose) : undefined,
        query.register ? ilike(schema.phraseEntries.register, query.register) : undefined,
        query.region ? ilike(schema.phraseEntries.region, query.region) : undefined,
        query.cefr ? ilike(schema.phraseEntries.cefr, query.cefr) : undefined,
        intentFilter(userId, "phrase", schema.phraseEntries.id, query.intent),
      );
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
      if (ids.length === 0 && Number(countRows[0]?.count ?? 0) === 0) return listContentDiscoveryPhrases(database, query);
      const [phraseRows, variantRows, occurrenceRows, representativeRows] = ids.length === 0
        ? [[], [], [], []] as const
        : await Promise.all([
          database.select().from(schema.phraseEntries).where(inArray(schema.phraseEntries.id, ids)),
          database.select({ phraseEntryId: schema.phraseVariants.phraseEntryId, expression: schema.phraseVariants.expression }).from(schema.phraseVariants).where(inArray(schema.phraseVariants.phraseEntryId, ids)),
          database.select({ phraseEntryId: schema.corpusOccurrences.phraseEntryId, count: sql<number>`count(*)` }).from(schema.corpusOccurrences).where(and(inArray(schema.corpusOccurrences.phraseEntryId, ids), visibleOccurrence)).groupBy(schema.corpusOccurrences.phraseEntryId),
          database.selectDistinctOn([schema.corpusOccurrences.phraseEntryId], {
            phraseEntryId: schema.corpusOccurrences.phraseEntryId,
            surfaceText: schema.corpusOccurrences.surfaceText,
            contextBefore: schema.corpusOccurrences.contextBefore,
            contextAfter: schema.corpusOccurrences.contextAfter,
            sourceTitle: schema.corpusOccurrences.sourceTitle,
            sourceKind: schema.corpusOccurrences.sourceKind,
            documentKind: schema.corpusOccurrences.documentKind,
            documentStableKey: schema.corpusOccurrences.documentStableKey,
            documentVersion: schema.corpusOccurrences.documentVersion,
            sourcePosition: schema.corpusOccurrences.sourcePosition,
          })
            .from(schema.corpusOccurrences)
            .where(and(inArray(schema.corpusOccurrences.phraseEntryId, ids), visibleOccurrence))
            .orderBy(asc(schema.corpusOccurrences.phraseEntryId), asc(schema.corpusOccurrences.createdAt), asc(schema.corpusOccurrences.id)),
        ]);
      const intentByKey = intentMap(intents);
      const representativeById = new Map(representativeRows.flatMap((row) => {
        if (!row.phraseEntryId) return [];
        return [[row.phraseEntryId, {
          ...buildKwic({
            surfaceText: row.surfaceText,
            contextBefore: row.contextBefore,
            contextAfter: row.contextAfter,
            sourceTitle: row.sourceTitle,
            sourceKind: row.sourceKind,
            documentKind: row.documentKind as "article" | "media",
            documentStableKey: row.documentStableKey,
            documentVersion: row.documentVersion,
            sourcePosition: row.sourcePosition as SourcePosition,
          }),
          entryKind: "phrase" as const,
          entryId: row.phraseEntryId,
          surfaceText: row.surfaceText,
        }]] as const;
      }));
      const byId = new Map<string, PhraseItem>(phraseRows.map((phrase) => [phrase.id, {
        id: phrase.id, expression: phrase.expression, normalizedExpression: phrase.normalizedExpression,
        scope: phrase.ownerUserId ? "private" : "public",
        meaningZh: phrase.meaningZh,
        pragmaticPurpose: phrase.pragmaticPurpose, register: phrase.register, region: phrase.region, cefr: phrase.cefr,
        variants: [] as string[], occurrenceCount: 0, representativeOccurrence: representativeById.get(phrase.id) ?? null, intent: null, revision: 1,
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
      const items = [...byId.values()];
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

    async listCorpusClusters(userId, query: CorpusBrowseQuery): Promise<{
      items: readonly CorpusCluster[];
      page: number;
      pageSize: number;
      total: number;
    }> {
      const search = query.query ? `%${query.query}%` : undefined;
      const contentFilter = query.contentKind === "article"
        ? eq(schema.corpusOccurrences.documentKind, "article")
        : query.contentKind === "video" || query.contentKind === "podcast"
          ? eq(schema.mediaItems.kind, query.contentKind)
          : undefined;
      const where = and(
        isNotNull(schema.corpusOccurrences.phraseEntryId),
        phraseVisibility(userId),
        corpusVisibility(userId),
        query.documentKind ? eq(schema.corpusOccurrences.documentKind, query.documentKind) : undefined,
        contentFilter,
        search ? or(ilike(schema.phraseEntries.expression, search), ilike(schema.phraseEntries.normalizedExpression, search)) : undefined,
      );
      const [idRows, countRows] = await Promise.all([
        database.select({
          id: schema.phraseEntries.id,
          expression: schema.phraseEntries.expression,
          meaningZh: schema.phraseEntries.meaningZh,
          pragmaticPurpose: schema.phraseEntries.pragmaticPurpose,
          latestAt: sql<Date>`max(${schema.corpusOccurrences.createdAt})`,
        })
          .from(schema.corpusOccurrences)
          .innerJoin(schema.phraseEntries, eq(schema.corpusOccurrences.phraseEntryId, schema.phraseEntries.id))
          .leftJoin(schema.mediaItems, and(eq(schema.mediaItems.stableKey, schema.corpusOccurrences.documentStableKey), eq(schema.corpusOccurrences.documentKind, "media")))
          .where(where)
          .groupBy(schema.phraseEntries.id, schema.phraseEntries.expression, schema.phraseEntries.meaningZh, schema.phraseEntries.pragmaticPurpose)
          .orderBy(desc(sql`max(${schema.corpusOccurrences.createdAt})`), asc(schema.phraseEntries.expression))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        database.select({ count: sql<number>`count(distinct ${schema.corpusOccurrences.phraseEntryId})` })
          .from(schema.corpusOccurrences)
          .innerJoin(schema.phraseEntries, eq(schema.corpusOccurrences.phraseEntryId, schema.phraseEntries.id))
          .leftJoin(schema.mediaItems, and(eq(schema.mediaItems.stableKey, schema.corpusOccurrences.documentStableKey), eq(schema.corpusOccurrences.documentKind, "media")))
          .where(where),
      ]);
      const ids = idRows.map((row) => row.id);
      if (ids.length === 0) return Number(countRows[0]?.count ?? 0) === 0
        ? listContentDiscoveryClusters(database, query)
        : { items: [], page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.count ?? 0) };

      // A cluster is deliberately bounded: three contexts per source kind keeps
      // the default page useful on mobile and prevents one prolific source from
      // starving the other phrases in the same page.
      const contextRows = await database.select({
        phraseEntryId: schema.corpusOccurrences.phraseEntryId,
        surfaceText: schema.corpusOccurrences.surfaceText,
        contextBefore: schema.corpusOccurrences.contextBefore,
        contextAfter: schema.corpusOccurrences.contextAfter,
        sourceTitle: schema.corpusOccurrences.sourceTitle,
        sourceKind: schema.corpusOccurrences.sourceKind,
        documentKind: schema.corpusOccurrences.documentKind,
        documentStableKey: schema.corpusOccurrences.documentStableKey,
        documentVersion: schema.corpusOccurrences.documentVersion,
        sourcePosition: schema.corpusOccurrences.sourcePosition,
        mediaKind: schema.mediaItems.kind,
      })
        .from(schema.corpusOccurrences)
        .innerJoin(schema.phraseEntries, eq(schema.corpusOccurrences.phraseEntryId, schema.phraseEntries.id))
        .leftJoin(schema.mediaItems, and(eq(schema.mediaItems.stableKey, schema.corpusOccurrences.documentStableKey), eq(schema.corpusOccurrences.documentKind, "media")))
        .where(and(
          inArray(schema.corpusOccurrences.phraseEntryId, ids),
          phraseVisibility(userId),
          corpusVisibility(userId),
          query.documentKind ? eq(schema.corpusOccurrences.documentKind, query.documentKind) : undefined,
          contentFilter,
        ))
        .orderBy(desc(schema.corpusOccurrences.createdAt), asc(schema.corpusOccurrences.id))
        .limit(Math.min(1_000, Math.max(100, ids.length * 30)));

      const contextsById = new Map<string, CorpusClusterContext[]>();
      for (const row of contextRows) {
        if (!row.phraseEntryId) continue;
        const kind: CorpusClusterContext["contentKind"] = row.documentKind === "article"
          ? "article"
          : row.mediaKind === "video" || row.mediaKind === "podcast" ? row.mediaKind : "article";
        const current = contextsById.get(row.phraseEntryId) ?? [];
        if (current.filter((item) => item.contentKind === kind).length >= 3) continue;
        current.push({
          ...buildKwic({
            surfaceText: row.surfaceText,
            contextBefore: row.contextBefore,
            contextAfter: row.contextAfter,
            sourceTitle: row.sourceTitle,
            sourceKind: row.sourceKind,
            documentKind: row.documentKind as "article" | "media",
            documentStableKey: row.documentStableKey,
            documentVersion: row.documentVersion,
            sourcePosition: row.sourcePosition as SourcePosition,
          }),
          entryKind: "phrase",
          entryId: row.phraseEntryId,
          surfaceText: row.surfaceText,
          contentKind: kind,
        });
        contextsById.set(row.phraseEntryId, current);
      }

      const order: CorpusClusterContext["contentKind"][] = ["article", "video", "podcast"];
      const items = idRows.flatMap((row) => {
        const contexts = contextsById.get(row.id) ?? [];
        if (contexts.length === 0) return [];
        const contentKinds = order.filter((kind) => contexts.some((context) => context.contentKind === kind));
        return [{ entryKind: "phrase" as const, entryId: row.id, expression: row.expression, meaningZh: row.meaningZh, pragmaticPurpose: row.pragmaticPurpose, contexts, contentKinds } satisfies CorpusCluster];
      });
      return { items, page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.count ?? 0) };
    },

    async searchCorpus(userId, query: CorpusQuery) {
      const tokens = query.query ? normalizeCorpusQuery(query.query) : [];
      if (tokens.length === 0 && !(query.entryKind && query.entryId)) return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
      const normalizedQuery = tokens.join(" ");
      const matchCondition = tokens.length === 0
        ? undefined
        : (query.match ?? "phrase") === "phrase"
          ? eq(schema.corpusOccurrences.normalizedText, normalizedQuery)
          : and(...tokens.map((token) => ilike(schema.corpusOccurrences.normalizedText, `%${token}%`)));
      const where = and(
        corpusVisibility(userId),
        matchCondition,
        query.entryKind === "lexeme" && query.entryId ? eq(schema.corpusOccurrences.lexemeId, query.entryId) : undefined,
        query.entryKind === "phrase" && query.entryId ? eq(schema.corpusOccurrences.phraseEntryId, query.entryId) : undefined,
        query.documentKind ? eq(schema.corpusOccurrences.documentKind, query.documentKind) : undefined,
        query.contentKind === "article" ? eq(schema.corpusOccurrences.documentKind, "article") : undefined,
        query.contentKind === "video" || query.contentKind === "podcast"
          ? sql`exists (select 1 from ${schema.mediaItems} mi where mi.stable_key = ${schema.corpusOccurrences.documentStableKey} and mi.kind = ${query.contentKind})`
          : undefined,
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
