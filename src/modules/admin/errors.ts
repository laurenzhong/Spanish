import type { ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

/**
 * Stable, route-mappable error for owner admin/account management actions.
 * Application layers throw it; the shared admin HTTP wrapper converts it into
 * the versioned error envelope. Messages must stay user-safe: no email, chat
 * content, tokens or provider internals.
 */
export class AdminActionError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AdminActionError";
  }
}
