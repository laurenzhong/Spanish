import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveWordAudioFrom } from "@/src/modules/lexicon-corpus/application/resolve-word-audio";
import { findWordAddress } from "@/src/modules/lexicon-corpus/repositories/word-address-reader";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

/**
 * Read one vocabulary word aloud from its real source, or say why the caller
 * should synthesize instead.
 *
 * Only the word is accepted from the client. The example text, the media and the
 * segment are all resolved on the server from the corpus, so a caller cannot
 * choose which media a word plays or which sentence it hears. The response is a
 * clip reference, never the media's segment list: the vocabulary shelf holds
 * thousands of words and must not receive a playback payload per click.
 */
const bodySchema = z.object({
  word: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{M}'\u2019-]+$/u),
  /** The example the shelf displays, when it has one; used only for diagnostics. */
  exampleText: z.string().trim().max(400).optional(),
}).strict();

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "原声暂时无法读取。");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语格式无效。");

  try {
    const database = getDatabase();
    const address = await findWordAddress(database, parsed.data.word);
    const mediaRepository = createDrizzleMediaRepository(database);
    const resolution = await resolveWordAudioFrom({
      address,
      word: parsed.data.word,
      // One segment, not the transcript: this route answers a single word, and loading
      // the whole playback for it measured 1.1 s against a 108-segment item. The narrow
      // read returns the playable asset plus the one row the address names.
      loadLookup: address?.documentStableKey && address.exampleText
        ? () => mediaRepository.getSegmentLookup(
          address.documentStableKey!,
          { segmentIndex: address.segmentIndex, expectedText: address.exampleText },
          new Date(),
        ).catch(() => null)
        : undefined,
    });
    return NextResponse.json(
      { apiVersion: API_VERSION, data: resolution },
      { headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "原声暂时无法读取。");
  }
}
