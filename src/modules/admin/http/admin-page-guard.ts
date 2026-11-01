import { notFound, redirect } from "next/navigation";

import { readAccountAccess } from "@/src/shared/auth/account-access";
import { isOwnerPrincipal } from "@/src/shared/auth/owner";
import { getCurrentUser } from "@/src/shared/auth/server";

export type AdminPageOwner = Readonly<{
  ownerId: string;
  ownerEmail: string | null;
  /** Database role when it could be read; env owners may have a null access row. */
  databaseRole: "owner" | "member" | null;
}>;

/**
 * Server-component guard for /admin pages.
 *
 * Next.js layouts do not re-render on client navigation, so layouts are not a
 * sufficient authorization boundary (see the App Router authentication guide).
 * Every admin page/layout that reads data calls this guard next to its data
 * source. Unauthenticated visitors go to /login; authenticated non-owners get
 * the same 404 as an unknown route so the console's existence is not confirmed.
 */
export async function requireAdminPageOwner(
  nextPath: string,
): Promise<AdminPageOwner> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const access = await readAccountAccess(user.id);
  if (!isOwnerPrincipal({ id: user.id, access })) {
    notFound();
  }

  return {
    ownerId: user.id,
    ownerEmail: user.email,
    databaseRole: access?.role ?? null,
  };
}
