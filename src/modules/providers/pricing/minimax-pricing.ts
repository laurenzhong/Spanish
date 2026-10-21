/**
 * What a MiniMax call costs, in the currency the vendor bills in.
 *
 * ## Why this file exists
 *
 * Every MiniMax adapter in this repo reports `estimatedCostMicros: null`, which
 * makes a run auditable in calls and latency but not in money. At 15,844 calls
 * for the reference-list route that is the number the owner will ask about, so
 * the rates belong in the repository rather than in someone's memory.
 *
 * ## The rates, and where they come from
 *
 * MiniMax's own pay-as-you-go page (`https://platform.minimaxi.com/docs/guides/
 * pricing`, "语言模型" table), read on 2026-10-12. Prices are **CNY per million
 * tokens** and `estimatedCostMicros` is therefore micros of CNY:
 *
 * | model | input | output |
 * |---|---|---|
 * | MiniMax-M3, ≤512k input (50% off, permanent) | 2.10 | 8.40 |
 * | MiniMax-M3, >512k input | 4.20 | 16.80 |
 * | MiniMax-M2.7 / M2.5 / M2.1 / M2 | 2.10 | 8.40 |
 * | the `-highspeed` variants | 4.20 | 16.80 |
 *
 * Two deliberate limitations:
 *
 * - **An unknown model returns `null`, never a guess.** A rate copied from the
 *   wrong row would be a fabricated number in an audit trail; `null` says "not
 *   priced here", which is true and actionable.
 * - **Cache reads and writes are ignored.** They are cheaper than input tokens
 *   (¥0.42/M and ¥2.625/M), and ignoring them over-states cost rather than
 *   under-stating it. Over-stating an estimate is the safe direction for a budget
 *   figure.
 *
 * The estimator needs **measured token counts** to be meaningful. When a caller
 * has none it must pass `null` through rather than deriving tokens from bytes:
 * the vendor's own guidance ("1600 Chinese characters ≈ 1000 tokens") is an
 * estimate, and an estimated token count multiplied by a real rate looks like a
 * measurement while being a guess.
 */

export type MiniMaxTokenRates = Readonly<{
  /** CNY per million input tokens. */
  inputPerMillion: number;
  /** CNY per million output tokens. */
  outputPerMillion: number;
  /** Input tokens above which the higher tier applies. */
  elevatedInputThreshold: number;
  /** CNY per million input tokens above {@link elevatedInputThreshold}. */
  elevatedInputPerMillion: number;
  /** CNY per million output tokens for a call whose input crossed the threshold. */
  elevatedOutputPerMillion: number;
}>;

const standardTier: MiniMaxTokenRates = {
  inputPerMillion: 2.1,
  outputPerMillion: 8.4,
  elevatedInputThreshold: 512_000,
  elevatedInputPerMillion: 4.2,
  elevatedOutputPerMillion: 16.8,
};

const highspeedTier: MiniMaxTokenRates = {
  inputPerMillion: 4.2,
  outputPerMillion: 16.8,
  elevatedInputThreshold: 512_000,
  elevatedInputPerMillion: 8.4,
  elevatedOutputPerMillion: 33.6,
};

/** Rates by the model version the adapters actually send. */
export const MINIMAX_TOKEN_RATES: Readonly<Record<string, MiniMaxTokenRates>> = {
  "MiniMax-M3": standardTier,
  "MiniMax-M3-highspeed": highspeedTier,
  "MiniMax-M2.7": standardTier,
  "MiniMax-M2.7-highspeed": highspeedTier,
  "MiniMax-M2.5": standardTier,
  "MiniMax-M2.5-highspeed": highspeedTier,
  "MiniMax-M2.1": standardTier,
  "MiniMax-M2.1-highspeed": highspeedTier,
  "MiniMax-M2": standardTier,
};

/**
 * Cost in CNY micros, or `null` when it cannot be stated honestly.
 *
 * `null` covers three cases and never throws: an unlisted model, a missing token
 * count, and a nonsensical count (negative or not an integer). The result is
 * rounded to whole micros, which is the unit the column stores.
 */
export function estimateMiniMaxCostMicros(input: Readonly<{
  modelVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
}>): number | null {
  const rates = MINIMAX_TOKEN_RATES[input.modelVersion];
  if (!rates) return null;
  const { inputTokens, outputTokens } = input;
  if (inputTokens === null || outputTokens === null) return null;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  if (inputTokens < 0 || outputTokens < 0) return null;

  const elevated = inputTokens > rates.elevatedInputThreshold;
  const inputRate = elevated ? rates.elevatedInputPerMillion : rates.inputPerMillion;
  const outputRate = elevated ? rates.elevatedOutputPerMillion : rates.outputPerMillion;
  // micros = tokens * CNY-per-million / 1e6 * 1e6, i.e. the rates themselves are
  // already the micros-per-token figure.
  return Math.round(inputTokens * inputRate + outputTokens * outputRate);
}

/** The same figure in CNY, for a report a human reads. */
export function microsToCny(micros: number | null): number | null {
  return micros === null ? null : micros / 1_000_000;
}
