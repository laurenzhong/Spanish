import { describe, expect, it } from "vitest";

import { buildLexicalEvidenceDraft } from "@/src/modules/lexicon-corpus/domain";

describe("lexical assessment evidence", () => {
  it("routes successful typing assessment to lexical skill evidence only", () => {
    const event = buildLexicalEvidenceDraft({
      userId: "00000000-0000-4000-0000-000000000001",
      assessmentAttemptId: "20000000-0000-4000-0000-000000000002",
      idempotencyKey: "assessment-attempt-1",
      assessmentItemId: "10000000-0000-4000-0000-000000000001",
      contentVersion: 2,
      skillKey: "lexical.context.greeting",
      score: 1,
      confidence: 0.9,
      occurredAt: new Date("2026-09-14T00:00:00.000Z"),
    });
    expect(event).toMatchObject({ sourceType: "lexical_assessment", modality: "typing", practiceAttemptId: null, outcomeScore: 1, evidenceWeight: 0.54 });
    expect(event.skillKey.startsWith("lexical.")).toBe(true);
  });
});
