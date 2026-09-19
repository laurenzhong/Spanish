import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicConfig } from "@/src/shared/auth/config";
import {
  isPublicRoute,
  resolveAuthRedirect,
} from "@/src/shared/auth/route-access";
import { isRetryableAuthError } from "@/src/shared/auth/errors";

// Auth can be slower on the first request after a browser navigation. Keep
// the optimistic route gate bounded, but do not turn normal network jitter
// into a false logged-out state.
const AUTH_LOOKUP_TIMEOUT_MS = 3_000;

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const e2eUser =
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_E2E_ENABLED === "1" &&
    request.cookies.has("spanish-e2e-user");
  let isAuthenticated = e2eUser;
  let authCheckFailed = false;
  const config = readSupabasePublicConfig();

  if (config && !e2eUser) {
    const client = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const value of values) {
            request.cookies.set(value.name, value.value);
          }
          response = NextResponse.next({ request });
          for (const value of values) {
            response.cookies.set(value.name, value.value, value.options);
          }
        },
      },
    });
    const { data, error } = await Promise.race([
      client.auth.getUser(),
      new Promise<{ data: { user: null }; error: { name: string; message: string } }>((resolve) => setTimeout(() => resolve({
        data: { user: null },
        error: { name: "AuthRetryableFetchError", message: "Authentication lookup timed out." },
      }), AUTH_LOOKUP_TIMEOUT_MS)),
    ]);
    if (error) {
      // Do not turn a transient Auth outage into a login redirect loop. The
      // protected product layout still performs the authoritative check.
      // Invalid or expired sessions are not an outage: send them through the
      // normal anonymous redirect so the user can obtain a fresh session.
      authCheckFailed = isRetryableAuthError(error);
    } else {
      isAuthenticated = Boolean(data.user);
    }
  }

  const redirectPath = authCheckFailed
    ? null
    : resolveAuthRedirect(request.nextUrl.pathname, isAuthenticated);
  if (redirectPath) {
    const redirectUrl = request.nextUrl.clone();
    const [pathname, search = ""] = redirectPath.split("?");
    redirectUrl.pathname = pathname;
    redirectUrl.search = search ? `?${search}` : "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Supabase may refresh the session while getUser() runs. Preserve those
    // Set-Cookie headers when the optimistic route gate redirects.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (authCheckFailed && !isPublicRoute(request.nextUrl.pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-auth-next-path", request.nextUrl.pathname);
    const nextResponse = NextResponse.next({ request: { headers: requestHeaders } });
    for (const cookie of response.cookies.getAll()) {
      nextResponse.cookies.set(cookie);
    }
    response = nextResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/login/:path*",
    "/learn/:path*",
    "/explore/:path*",
    "/chat/:path*",
    "/me/:path*",
  ],
};
