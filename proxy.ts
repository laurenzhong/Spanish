import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicConfig } from "@/src/shared/auth/config";
import { resolveAuthRedirect } from "@/src/shared/auth/route-access";

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
    const { data, error } = await client.auth.getUser();
    if (error) {
      // Do not turn a transient Auth outage into a login redirect loop. The
      // protected product layout still performs the authoritative check.
      authCheckFailed = true;
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
