import { describe, expect, it } from "vitest";

import { estimateMiniMaxCostMicros, microsToCny, MINIMAX_TOKEN_RATES } from "@/src/modules/providers/pricing/minimax-pricing";

/**
 * The price table.
 *
 * Rates are CNY per million tokens from MiniMax's own pay-as-you-go page. These
 * tests pin the arithmetic and — more importantly — the two ways the function is
 * allowed to say "I do not know": an unlisted model and a missing token count.
 * A number invented from a wrong row would sit in an audit trail looking like a
 * measurement.
 */

describe("MiniMax cost estimation", () => {
  it("prices one million output tokens at the listed rate", () => {
    // Input is kept under the 512k tier threshold: above it the elevated rate
    // applies, which the tier test below covers.
    expect(estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 500_000, outputTokens: 0 })).toBe(1_050_000);
    expect(estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 0, outputTokens: 1_000_000 })).toBe(8_400_000);
  });

  it("prices a review-shaped call", () => {
    // The measured shape: ~5 kB request, a few hundred tokens out.
    const micros = estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 4_000, outputTokens: 300 });
    expect(micros).toBe(Math.round(4_000 * 2.1 + 300 * 8.4));
    expect(microsToCny(micros)).toBeCloseTo(0.0109, 4);
  });

  it("applies the higher tier above 512k input tokens", () => {
    const below = estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 512_000, outputTokens: 0 });
    const above = estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 512_001, outputTokens: 0 });
    expect(below).toBe(Math.round(512_000 * 2.1));
    expect(above).toBe(Math.round(512_001 * 4.2));
  });

  it("prices the highspeed variants at double", () => {
    const standard = estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M2.7", inputTokens: 1_000, outputTokens: 1_000 });
    const highspeed = estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M2.7-highspeed", inputTokens: 1_000, outputTokens: 1_000 });
    expect(highspeed).toBe((standard ?? 0) * 2);
  });

  it("returns null rather than guessing", () => {
    // An unlisted model.
    expect(estimateMiniMaxCostMicros({ modelVersion: "gpt-5", inputTokens: 1_000, outputTokens: 1_000 })).toBeNull();
    // Tokens not measured.
    expect(estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: null, outputTokens: 10 })).toBeNull();
    expect(estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 10, outputTokens: null })).toBeNull();
    // Nonsense.
    expect(estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: -1, outputTokens: 1 })).toBeNull();
    expect(estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: Number.NaN, outputTokens: 1 })).toBeNull();
  });

  it("never reports a zero cost for a real call", () => {
    // A zero would read as "this call was free", which is the one answer that is
    // certainly wrong for a paid endpoint.
    const micros = estimateMiniMaxCostMicros({ modelVersion: "MiniMax-M3", inputTokens: 1, outputTokens: 1 });
    expect(micros).toBeGreaterThan(0);
  });

  it("keeps every listed rate positive and above its elevated tier", () => {
    for (const [model, rates] of Object.entries(MINIMAX_TOKEN_RATES)) {
      expect(rates.inputPerMillion, model).toBeGreaterThan(0);
      expect(rates.outputPerMillion, model).toBeGreaterThan(rates.inputPerMillion);
      expect(rates.elevatedInputPerMillion, model).toBeGreaterThan(rates.inputPerMillion);
      expect(rates.elevatedOutputPerMillion, model).toBeGreaterThan(rates.outputPerMillion);
    }
  });
});
