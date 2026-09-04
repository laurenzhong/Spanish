export type AuthUserLookupError = Readonly<{
  code?: string;
  message?: string;
  name?: string;
  status?: number;
}>;

/**
 * Only errors that may recover without changing the user's identity are
 * treated as an authentication service outage. Invalid or expired sessions
 * must follow the normal anonymous redirect path instead.
 */
export function isRetryableAuthError(
  error: AuthUserLookupError | null,
): boolean {
  if (!error) {
    return false;
  }

  if (error.name === "AuthRetryableFetchError") {
    return true;
  }

  if (typeof error.status === "number" && error.status >= 500) {
    return true;
  }

  return /connection reset|failed to fetch|network error|timed? out|temporarily unavailable/iu.test(
    error.message ?? "",
  );
}
