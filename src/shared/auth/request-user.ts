import type { NextRequest } from "next/server";

import type { AuthenticatedUser } from "./server";

export type RequestUserOptions = Readonly<{
  verifyRequestUser: (request: NextRequest) => Promise<AuthenticatedUser | null>;
  getCurrentUser: () => Promise<AuthenticatedUser | null>;
}>;

/**
 * Resolve the identity for an API request without allowing an invalid bearer
 * token to fall through to a cookie session.  Web requests omit Authorization
 * and use the Supabase cookie; native clients send a bearer token.
 */
export async function getRequestUser(
  request: NextRequest,
  options: RequestUserOptions,
): Promise<AuthenticatedUser | null> {
  // Keep the E2E/test-cookie path (and any future request-bound verifier)
  // centralized in verifyRequestUser.  Only an absent Authorization header
  // may continue to the cookie-backed session lookup.
  const verified = await options.verifyRequestUser(request);
  if (verified || request.headers.has("authorization")) return verified;
  return options.getCurrentUser();
}
