"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "./browser";

type AuthRecoveryActionsProps = Readonly<{
  nextPath: string;
}>;

/** Clears only this browser's cached session before returning to OTP login. */
export function AuthRecoveryActions({ nextPath }: AuthRecoveryActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resetLocalSession() {
    if (busy) return;
    setBusy(true);

    try {
      const client = createSupabaseBrowserClient();
      // A local sign-out removes the browser cookie/storage without requiring
      // the Auth service to be reachable, which is important on this page.
      await client?.auth.signOut({ scope: "local" });
    } finally {
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      router.refresh();
    }
  }

  return (
    <button className="secondary-action" type="button" onClick={() => void resetLocalSession()} disabled={busy}>
      {busy ? "正在清除本地会话…" : "清除本地会话并重新登录"}
    </button>
  );
}
