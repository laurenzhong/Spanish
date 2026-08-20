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
