import type { ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

/**
 * Machine-readable reason for a VALIDATION_FAILED result. The HTTP route owns
 * the user-facing Chinese copy; the application layer only states why the
 * request could not be fulfilled.
 */
export type ConversationAssistantErrorReason = "no-target-sentence";

export class ConversationAssistantError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly reason?: ConversationAssistantErrorReason,
  ) {
    super(code);
    this.name = "ConversationAssistantError";
  }
}
