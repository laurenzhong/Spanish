const publicRoutes = ["/", "/login", "/login/password"] as const;

export function isPublicRoute(pathname: string): boolean {
  return publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function resolveAuthRedirect(
  pathname: string,
  isAuthenticated: boolean,
): string | null {
  if (!isAuthenticated && !isPublicRoute(pathname)) {
    return `/login?next=${encodeURIComponent(pathname)}`;
  }

  if (isAuthenticated && pathname.startsWith("/login")) {
    return "/learn";
  }

  return null;
}

export function resolvePostLoginTarget(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/learn";
  }

  try {
    const target = new URL(next, "https://auth-target.invalid");
    if (target.origin !== "https://auth-target.invalid" || target.pathname.startsWith("/login")) {
      return "/learn";
    }
    return `${target.pathname}${target.search}`;
  } catch {
    return "/learn";
  }
}
