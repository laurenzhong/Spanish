/**
 * One-off smoke test of the REAL MiniMax lexicon extraction adapter.
 *
 * Sends a single public news segment (no user data, no audio) and prints the
 * proposals. Read-only: writes nothing, indexes nothing, approves nothing.
 *
 * Usage: tsx --env-file=.env scripts/smoke-lexicon-extraction.ts
 */
import { config as loadDotEnv } from "dotenv";

import { createMiniMaxLexiconExtractionProvider } from "../src/modules/providers/lexicon-extraction/minimax-lexicon-extraction";
import { LexiconExtractionError } from "../src/modules/providers/lexicon-extraction/lexicon-extraction";

// Same loading order as the other provider scripts in this repo.
loadDotEnv({ quiet: true });

const segment = {
  documentKind: "article" as const,
  documentStableKey: "smoke.lexicon.001",
  documentVersion: 1,
  segmentIndex: 0,
  sourceText: "Y en Panamá, un terremoto de magnitud 7.2 acudió el sureste del país, cerca de la costa del Pacífico.",
  translation: "在巴拿马，一场7.2级地震袭击了该国东南部，靠近太平洋海岸。",
  sourceTitle: "Alerta de tsunami en el Pacífico",
  sourceKind: "article-rss",
};

const provider = createMiniMaxLexiconExtractionProvider({
  apiKey: process.env.MINIMAX_API_KEY ?? "",
});

console.log("api key present:", Boolean(process.env.MINIMAX_API_KEY?.trim()));
console.log("MINIMAX_BASE_URL:", process.env.MINIMAX_BASE_URL ?? "(unset)");

/**
 * When the adapter rejects a response, the interesting artefact is the raw text
 * the model produced — not just the coded error. This wrapper makes one extra
 * call with the same wire shape so a schema mismatch can be diagnosed rather
 * than guessed at.
 */
async function dumpRawResponse(): Promise<void> {
  const endpoint =
    process.env.MINIMAX_ANTHROPIC_ENDPOINT ?? "https://api.minimaxi.com/anthropic/v1/messages";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": process.env.MINIMAX_API_KEY ?? "",
    },
    body: JSON.stringify({
      model: "MiniMax-M3",
      max_tokens: 2_000,
      thinking: { type: "disabled" },
      system:
        'You propose vocabulary candidates for a Spanish learning corpus. Return JSON only, shaped as {"proposals":[...]} where each item has kind, surfaceText, lemma, partOfSpeech, meaningZh, segmentIndex, confidence.',
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task: "propose_lexicon_candidates",
                language: "es",
                segments: [{ segmentIndex: 0, sourceText: segment.sourceText, translation: segment.translation }],
              }),
            },
          ],
        },
      ],
    }),
  });
  console.log("raw probe status:", response.status);
  const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = payload.content?.map((block) => block.text ?? "").join("\n") ?? "";
  console.log("raw text (first 1200 chars):");
  console.log(text.slice(0, 1_200));
}

try {
  const started = Date.now();
  const result = await provider.extractCandidates({
    language: "es",
    segments: [segment],
    maxCandidatesPerSegment: 12,
  });
  console.log("elapsed ms:", Date.now() - started);
  console.log("provider:", result.provider, "| model:", result.modelVersion);
  console.log("request id:", result.providerRequestId);
  console.log("safety:", JSON.stringify(result.safety));
  console.log("proposal count:", result.proposals.length);
  for (const proposal of result.proposals) {
    console.log(
      `  [${proposal.kind}] ${proposal.surfaceText} | lemma=${proposal.lemma} | pos=${proposal.partOfSpeech} | zh=${proposal.meaningZh} | conf=${proposal.confidence}`,
    );
  }

  // Guard checks that matter most: every lexeme's surface form must exist in the
  // segment, and no lexeme may carry a phrase translation.
  const lower = segment.sourceText.toLocaleLowerCase("es");
  const hallucinated = result.proposals.filter(
    (proposal) => !lower.includes(proposal.surfaceText.toLocaleLowerCase("es")),
  );
  const crossKind = result.proposals.filter(
    (proposal) =>
      (proposal.kind === "lexeme" && proposal.meaningZh !== null) ||
      (proposal.kind === "phrase" && proposal.lemma !== null),
  );
  console.log("hallucinated (not in segment):", hallucinated.length);
  console.log("cross-kind malformed:", crossKind.length);
} catch (error) {
  if (error instanceof LexiconExtractionError) {
    console.log("LexiconExtractionError:", error.code, "| retryable:", error.retryable, "|", error.message);
    if (error.code === "provider-response-invalid") {
      console.log("\n--- diagnosing the rejected response ---");
      await dumpRawResponse().catch((cause) => console.log("raw probe failed:", String(cause).slice(0, 200)));
    }
  } else {
    console.log("unexpected error:", error);
  }
  process.exitCode = 1;
}
