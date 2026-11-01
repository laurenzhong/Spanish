import type { ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

/**
 * Stable, route-mappable error for account application use cases
 * (ACCT-ADMIN-001). `withAdminOwner` converts any coded error with a numeric
 * status into the versioned error envelope, so the same error class is reused by
 * the public invitation-redemption Route Handler with its own mapping.
 *
 * Messages must stay user-safe: never include an email address, invitation
 * code, token, chat content or provider internals.
 */
export class AccountActionError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AccountActionError";
  }
}

export function isAccountActionError(error: unknown): error is AccountActionError {
  return error instanceof AccountActionError;
}
