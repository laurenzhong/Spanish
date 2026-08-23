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
    const { data } = await client.auth.getSession();
    isAuthenticated = Boolean(data.session);
  }

  const redirectPath = resolveAuthRedirect(
    request.nextUrl.pathname,
    isAuthenticated,
  );
  if (redirectPath) {
    const redirectUrl = request.nextUrl.clone();
    const [pathname, search = ""] = redirectPath.split("?");
    redirectUrl.pathname = pathname;
    redirectUrl.search = search ? `?${search}` : "";
    return NextResponse.redirect(redirectUrl);
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
