import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cache } from "react";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { readSupabasePublicConfig } from "./config";
import {
  isRetryableAuthError,
  type AuthUserLookupError,
} from "./errors";

export { isRetryableAuthError } from "./errors";

export type AuthenticatedUser = Readonly<{
  email: string | null;
  id: string;
}>;

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedUser | null>;
}

export type AuthUserLookupResult = Readonly<{
  data: Readonly<{
    user: Readonly<{ email?: string | null; id: string }> | null;
  }>;
  error: AuthUserLookupError | null;
}>;

export async function getUserWithRetry(
  readUser: () => Promise<AuthUserLookupResult>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<AuthUserLookupResult> {
  const firstResult = await readUser();
  if (!isRetryableAuthError(firstResult.error)) {
    return firstResult;
  }

  await wait(150);
  return readUser();
}

function testUserFromCookie(
  cookieValue: string | undefined,
): AuthenticatedUser | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.AUTH_E2E_ENABLED !== "1" ||
    !cookieValue
  ) {
    return null;
  }

  return { id: cookieValue, email: "e2e@example.test" };
}

export function createSupabaseAccessTokenVerifier(): AccessTokenVerifier | null {
  const config = readSupabasePublicConfig();
  if (!config) {
    return null;
  }

  const client = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return {
    async verify(accessToken) {
      const { data, error } = await client.auth.getUser(accessToken);
      if (error || !data.user) {
        return null;
      }

      return { id: data.user.id, email: data.user.email ?? null };
    },
  };
}

async function readCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const testUser = testUserFromCookie(
    cookieStore.get("spanish-e2e-user")?.value,
  );
  if (testUser) {
    return testUser;
  }

  const config = readSupabasePublicConfig();
  if (!config) {
    return null;
  }

  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          for (const value of values) {
            cookieStore.set(value.name, value.value, value.options);
          }
        } catch {
          // Server Components cannot always write cookies. proxy.ts refreshes
          // the session before protected routes reach this authorization check.
        }
      },
    },
  });
  const { data, error } = await getUserWithRetry(() => client.auth.getUser());

  if (error || !data.user) {
    return null;
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

// Layouts and server pages in the same render frequently need the current
// user independently. React's request-scoped cache prevents duplicate remote
// Supabase lookups without weakening the authoritative auth check.
export const getCurrentUser = cache(readCurrentUser);

export async function verifyRequestUser(
  request: NextRequest,
  verifier: AccessTokenVerifier | null = createSupabaseAccessTokenVerifier(),
): Promise<AuthenticatedUser | null> {
  const testUser = testUserFromCookie(
    request.cookies.get("spanish-e2e-user")?.value,
  );
  if (testUser) {
    return testUser;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !verifier) {
    return null;
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) {
    return null;
  }

  return verifier.verify(accessToken);
}
