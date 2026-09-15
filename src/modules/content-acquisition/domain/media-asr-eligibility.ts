import { evaluateProcessingBudget, type ProcessingBudgetDecision, type ProcessingBudgetPolicy, type ProcessingBudgetUsage } from "./budget-policy";
import { evaluateSourcePolicy, type SourceRightsStatus } from "./source-policy";

export type MediaTranscriptSource = "platform_manual" | "platform_auto" | "asr" | "none";

export type MediaAsrEligibilityInput = Readonly<{
  contentType: "video" | "podcast" | "article";
  language: string;
  sourceEnabled: boolean;
  rightsStatus: SourceRightsStatus;
  durationMs: number;
  assetBytes: number;
  budgetPolicy: ProcessingBudgetPolicy;
  budgetUsage: ProcessingBudgetUsage;
  estimatedCostMicros: number;
  hasManualTranscript: boolean;
  hasAutomaticTranscript: boolean;
}>;

export type MediaAsrEligibilityDecision =
  | Readonly<{ allowed: true; transcriptSource: "asr" }>
  | Readonly<{
      allowed: false;
      reason:
        | "unsupported-content"
        | "language"
        | "existing-transcript"
        | "source-disabled"
        | "rights-required"
        | "rights-restricted"
        | "rights-revoked"
        | "daily-cost"
        | "monthly-cost"
        | "asset-size"
        | "duration";
      transcriptSource: "platform_manual" | "platform_auto" | "none";
    }>;

type MediaAsrBlockReason = "unsupported-content" | "language" | "existing-transcript" | "source-disabled" | "rights-required" | "rights-restricted" | "rights-revoked" | "daily-cost" | "monthly-cost" | "asset-size" | "duration";

function budgetReason(decision: ProcessingBudgetDecision): MediaAsrBlockReason {
  if ("reason" in decision) return decision.reason;
  throw new Error("A successful budget decision has no rejection reason.");
}

/** Select the least expensive trustworthy transcript source before considering ASR. */
export function evaluateMediaAsrEligibility(input: MediaAsrEligibilityInput): MediaAsrEligibilityDecision {
  if (input.hasManualTranscript) return { allowed: false, reason: "existing-transcript", transcriptSource: "platform_manual" };
  if (input.hasAutomaticTranscript) return { allowed: false, reason: "existing-transcript", transcriptSource: "platform_auto" };
  if (!["video", "podcast"].includes(input.contentType)) return { allowed: false, reason: "unsupported-content", transcriptSource: "none" };
  if (input.language.toLowerCase() !== "es") return { allowed: false, reason: "language", transcriptSource: "none" };

  const source = evaluateSourcePolicy({ enabled: input.sourceEnabled, rightsStatus: input.rightsStatus, operation: "process" });
  if (!source.allowed) return { allowed: false, reason: source.reason, transcriptSource: "none" };

  const budget = evaluateProcessingBudget(input.budgetPolicy, input.budgetUsage, {
    estimatedCostMicros: input.estimatedCostMicros,
    assetBytes: input.assetBytes,
    durationSeconds: Math.ceil(input.durationMs / 1_000),
  });
  if (!budget.allowed) return { allowed: false, reason: budgetReason(budget), transcriptSource: "none" };
  return { allowed: true, transcriptSource: "asr" };
}
