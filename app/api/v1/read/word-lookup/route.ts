import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDrizzleLexiconCorpusRepository } from "@/src/modules/lexicon-corpus/repositories";
import { findContentFrequencyWord } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { loadLrMeaningAsset } from "@/src/modules/lexicon-corpus/application/lr-meaning-asset";
import { loadTatoebaExampleAsset } from "@/src/modules/lexicon-corpus/application/tatoeba-examples";
import { normalizeSpanishSurface } from "@/src/modules/lexicon-corpus/domain/spanish-token";
import { wordEntry } from "@/src/modules/lexicon-corpus/ui/word-entry";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

/**
 * The word panel's own lookup: what one word means.
 *
 * The panel is opened from a tile, so a reader can only look at words the shelf put
 * in front of them. The sheet's reader, however, wants to look up a word they are
 * thinking about — Language Reactor's drawer has an input for exactly that — and
 * that word may not be on the current page, or in the current search result.
 *
 * The answer is deliberately the *same* answer the shelf would have given: the
 * reference list decides whether the word exists at all, the corpus contributes its
 * count and one published excerpt, and `wordEntry` decides the meanings, so this
 * route and the page cannot drift apart. The excerpt travels because the panel
 * already carries it per word and the shelf tile shows it.
 *
 * Authentication mirrors `word-audio`: this is published content behind the
 * product's own sign-in, and the route reads no user data of its own.
 */
const inputSchema = z.object({ word: z.string().trim().min(1).max(64) }).strict();

function errorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user =
    (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语查询请求格式无效。");
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语查询请求格式无效。");

  // The shelf can speak about a word it does not render, but a *word's own examples* are
  // wanted for words that are on the page — where the panel needs them the moment the word is
  // opened, and where the page no longer ships them (every word's examples measured 737 KB of
  // the document). This answers that narrow question, and it reads no corpus at all: the
  // examples are an asset, so it works even with no database configured.
  if (new URL(request.url).searchParams.get("fields") === "tatoeba") {
    const listed = findContentFrequencyWord(parsed.data.word);
    const examples = listed ? loadTatoebaExampleAsset().examples[normalizeSpanishSurface(listed.word)] ?? [] : [];
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { word: listed?.word ?? parsed.data.word, tatoeba: examples } },
      { headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  // The same code `word-audio` uses for "the database is not configured": the
  // contract has no narrower one, and 503 with INTERNAL_ERROR is what the sibling
  // route already returns for this state.
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "词汇数据暂时不可用。");
  }

  // The reference list answers first: a word it does not carry is not a word this
  // shelf can speak about, and saying so is more honest than an empty card.
  const listed = findContentFrequencyWord(parsed.data.word);
  if (!listed) {
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { found: false as const, word: parsed.data.word } },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }

  try {
    const repository = createDrizzleLexiconCorpusRepository(getDatabase());
    const item = await repository.readFrequencyWord(listed.word);
    if (!item) {
      return NextResponse.json(
        { apiVersion: API_VERSION, data: { found: false as const, word: listed.word } },
        { headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }

    const row = wordEntry(item, loadLrMeaningAsset().meanings[item.word]);
    // The same asset the shelf page read, so a looked-up word shows the same examples.
    const tatoeba = loadTatoebaExampleAsset().examples[item.normalizedWord] ?? [];
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          found: true as const,
          word: row.word,
          markKey: row.markKey,
          meanings: row.meanings.meanings,
          meaningSource: row.meanings.source,
          usageNotes: row.usageNotes,
          cefr: row.cefr,
          partOfSpeech: row.partOfSpeech,
          collocations: row.collocations,
          examples: row.examples,
          forms: row.forms,
          tatoeba,
          context: item.context,
          sourceTitle: item.sourceTitle,
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "词语查询暂时不可用，请稍后重试。");
  }
}
