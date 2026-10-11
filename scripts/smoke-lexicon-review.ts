/**
 * Smoke test of the REAL MiniMax candidate-review adapter.
 *
 * One **synthetic** frozen candidate, both dimensions, nothing else. No user
 * data, no audio, no transcript: the candidate below is written by hand and the
 * "context" is invented for the purpose. Read-only: writes nothing, approves
 * nothing, indexes nothing.
 *
 * Cost note: this script performs **two** paid MiniMax calls, one per dimension,
 * and it refuses to run unless `SMOKE_LEXICON_REVIEW=1` is set, so it cannot be
 * triggered by accident from a script runner.
 *
 * Run it like the other provider scripts, because api.minimaxi.com is not
 * reachable directly from this machine (`--conditions=react-server` is required
 * or the `server-only` import throws outside Next):
 *
 *   $env:HTTPS_PROXY="http://127.0.0.1:7897"
 *   node --use-env-proxy --conditions=react-server --import tsx/esm scripts/smoke-lexicon-review.ts
 */
import { config as loadDotEnv } from "dotenv";

import { isOwnerAuthorizedReviewerReference } from "../src/modules/content-acquisition/domain/review-identity";
import { createMiniMaxCandidateReviewer } from "../src/modules/providers/lexicon-review/server";
import { MiniMaxLexiconReviewError } from "../src/modules/providers/lexicon-review";
import type { LexiconCandidate } from "../src/modules/lexicon-corpus/domain/lexicon-candidate";
import { lexiconReviewDimensionValues } from "../src/modules/lexicon-corpus/domain/lexicon-candidate";

// Same loading order as the other provider scripts in this repo.
loadDotEnv({ quiet: true });

if (process.env.SMOKE_LEXICON_REVIEW !== "1") {
  console.log("refusing to spend two paid calls: set SMOKE_LEXICON_REVIEW=1 to run this smoke test.");
  process.exit(0);
}

const now = new Date("2026-10-11T00:00:00.000Z");

/** A hand-written, synthetic candidate. Not derived from any user or content row. */
const candidate: LexiconCandidate = {
  id: "lexeme|article|smoke.lexicon.review.001|1|0|terremoto",
  kind: "lexeme",
  surfaceText: "terremoto",
  normalizedText: "terremoto",
  lemma: "terremoto",
  partOfSpeech: "NOUN",
  meaningZh: null,
  status: "review_submitted",
  revision: 2,
  source: {
    documentKind: "article",
    documentStableKey: "smoke.lexicon.review.001",
    documentVersion: 1,
    segmentIndex: 0,
    contextBefore: "Y en Panamá, un",
    contextAfter: "de magnitud 7.2 sacudió el sureste del país.",
    sourceTitle: "Alerta de tsunami en el Pacífico",
    sourceKind: "article-rss",
  },
  reviews: [],
  approvedBy: null,
  approvedAt: null,
  rejectedReason: null,
  createdAt: now,
  updatedAt: now,
};

/**
 * `SMOKE_LEXICON_REVIEW_TRACE=1` wraps the global fetch so the *exact* request
 * and response text the adapter saw are printed. Without it, a `fail` verdict
 * can only be guessed at. The wrapper prints only what the adapter itself sends,
 * which for this script is synthetic data written by hand above.
 *
 * This must run **before** the adapter is constructed: the adapter resolves
 * `fetch` in its constructor, so wrapping afterwards has no effect.
 */
if (process.env.SMOKE_LEXICON_REVIEW_TRACE === "1") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : null;
    if (body) {
      const parsed = JSON.parse(body) as { system?: string; messages?: unknown };
      console.log("--- adapter request: user payload ---");
      console.log(JSON.stringify(parsed.messages).slice(0, 600));
    }
    const response = await originalFetch(input, init);
    const text = await response.clone().text();
    console.log("--- adapter response body (verbatim) ---");
    console.log(text);
    return response;
  };
}

/**
 * The adapter's own telemetry sink, used here for the smoke log. It is the
 * public `observe` hook rather than a bespoke logger, so this script exercises
 * the same observance path a future pipeline would.
 */
const observations: string[] = [];
const reviewer = createMiniMaxCandidateReviewer({
  observe: (observation) => {
    observations.push(
      `[${observation.dimension}] observation: ${JSON.stringify(observation)}`,
    );
  },
});

console.log("api key present:", Boolean(process.env.MINIMAX_API_KEY?.trim()));
console.log("MINIMAX_API_ENDPOINT:", process.env.MINIMAX_API_ENDPOINT ?? "(unset, using default)");
console.log("candidate:", candidate.kind, candidate.surfaceText, "| dims:", lexiconReviewDimensionValues.join(", "));
console.log("");

/**
 * Whether the endpoint actually returns `x-request-id`. The adapter records it
 * when present, so the smoke run has to state whether "null" means "vendor does
 * not send one" or "adapter dropped it". This probe sends no candidate data.
 */
async function probeRequestIdHeader(): Promise<void> {
  const endpoint = process.env.MINIMAX_API_ENDPOINT ?? "https://api.minimaxi.com/anthropic/v1/messages";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.MINIMAX_API_KEY ?? "",
      },
      body: JSON.stringify({
        model: "MiniMax-M3",
        max_tokens: 16,
        thinking: { type: "disabled" },
        system: "Answer with the single word ok.",
        messages: [{ role: "user", content: [{ type: "text", text: "ok?" }] }],
      }),
    });
    const headerNames = [...response.headers.keys()].sort();
    console.log("probe status:", response.status);
    console.log("probe x-request-id:", response.headers.get("x-request-id") ?? "(absent)");
    console.log("probe response headers:", headerNames.join(", ") || "(none)");
  } catch (error) {
    console.log("probe failed:", String(error).slice(0, 200));
  }
  console.log("");
}

let failures = 0;

// The header probe is a third paid call, so it only runs when asked for.
if (process.env.SMOKE_LEXICON_REVIEW_PROBE === "1") await probeRequestIdHeader();

/**
 * Dump one raw vendor verdict so a `fail` is reported with its actual reasoning
 * instead of a guess. Only runs with `SMOKE_LEXICON_REVIEW_RAW=1`, and it asks
 * about the same synthetic candidate — no user data, no content rows.
 *
 * This is a *diagnostic* call, not part of the adapter's path: the adapter itself
 * never exposes the raw payload, because downstream records must not carry it.
 */
async function dumpRawVerdict(dimension: (typeof lexiconReviewDimensionValues)[number]): Promise<void> {
  const endpoint = process.env.MINIMAX_API_ENDPOINT ?? "https://api.minimaxi.com/anthropic/v1/messages";
  const system =
    "You review one candidate for a Spanish learning corpus. Answer one dimension. Return JSON only, with exactly the keys: outcome, dimension, languageVerdict, teachingVerdict, reason, evidence, issues.";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.MINIMAX_API_KEY ?? "",
      },
      body: JSON.stringify({
        model: "MiniMax-M3",
        max_tokens: 4_000,
        thinking: { type: "disabled" },
        system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({ dimension, candidate, task: "review_lexicon_candidate" }),
              },
            ],
          },
        ],
      }),
    });
    const payload = (await response.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    const text = payload.content?.map((block) => block.text ?? "").join("\n") ?? "";
    console.log(`[${dimension}] raw verdict (status ${response.status}, stop_reason ${payload.stop_reason ?? "?"}):`);
    console.log(text.slice(0, 1_500));
  } catch (error) {
    console.log(`[${dimension}] raw dump failed:`, String(error).slice(0, 200));
  }
  console.log("");
}

for (const dimension of lexiconReviewDimensionValues) {
  const started = Date.now();
  try {
    const decision = await reviewer.review({ candidate, dimension });
    const elapsed = Date.now() - started;
    console.log(`[${dimension}] outcome: ${decision.outcome}`);
    console.log(`[${dimension}] reviewerReference: ${decision.reviewerReference}`);
    console.log(`[${dimension}] reviewedAt: ${decision.reviewedAt.toISOString()}`);
    console.log(`[${dimension}] wall ms: ${elapsed}`);
    if (!isOwnerAuthorizedReviewerReference(decision.reviewerReference)) {
      console.log(`[${dimension}] UNEXPECTED: reviewer reference is not owner-authorized`);
      failures += 1;
    }
    if (decision.dimension !== dimension) {
      console.log(`[${dimension}] UNEXPECTED: answered dimension ${decision.dimension}`);
      failures += 1;
    }
    if (process.env.SMOKE_LEXICON_REVIEW_RAW === "1") await dumpRawVerdict(dimension);
  } catch (error) {
    failures += 1;
    if (error instanceof MiniMaxLexiconReviewError) {
      // Fail-closed is the expected behaviour here too: no verdict, coded error.
      console.log(`[${dimension}] MiniMaxLexiconReviewError: ${error.code} | retryable: ${error.retryable}`);
      console.log(`[${dimension}] message: ${error.message}`);
    } else {
      console.log(`[${dimension}] unexpected error:`, error);
    }
  }
  console.log("");
}

console.log("adapter observations (from the observe hook):");
for (const line of observations) console.log(line);
console.log("");
console.log(failures === 0 ? "smoke result: both dimensions answered with a verdict" : `smoke result: ${failures} dimension(s) did not produce a verdict`);
process.exitCode = failures === 0 ? 0 : 1;
