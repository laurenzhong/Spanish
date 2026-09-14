import { describe, expect, it } from "vitest";

import { evaluateLexicalAnswer, normalizeAssessmentAnswer } from "@/src/modules/lexicon-corpus/domain";

const item = {
  id: "10000000-0000-4000-8000-000000000001",
  version: 2,
  promptType: "cloze" as const,
  prompt: "Necesito ___ ayuda.",
  options: [],
  acceptedAnswers: ["un poco de", "un poquito de"],
  skillKey: "lexical.retrieval.written.need-help",
  contentVersion: 2,
};

describe("lexical assessment", () => {
  it("accepts normalized spelling and natural equivalent answers", () => {
    expect(normalizeAssessmentAnswer("  Un  POQUITO de ")).toBe("un poquito de");
    expect(evaluateLexicalAnswer(item, "un poquito de")).toMatchObject({ passed: true, score: 1 });
  });

  it("does not accept a wrong answer and never evaluates oral-only skills", () => {
    expect(evaluateLexicalAnswer(item, "mucha")).toMatchObject({ passed: false, score: 0 });
    expect(() => evaluateLexicalAnswer({ ...item, skillKey: "pronunciation.segment" }, "un poco de")).toThrow("LEXICAL_SKILL_INVALID");
  });
});
