"use client";

const FALLBACK_SCOPE = "anonymous";

/**
 * The product shell writes an opaque, server-derived user scope. Keeping the
 * scope out of the URL and using a fallback for tests prevents conversation
 * caches from becoming an accidental cross-account data channel.
 */
export function getConversationCacheScope(): string {
  if (typeof document === "undefined") return FALLBACK_SCOPE;
  const scope = document.querySelector<HTMLElement>("[data-conversation-cache-scope]")
    ?.dataset.conversationCacheScope;
  return scope?.trim() || FALLBACK_SCOPE;
}

export function isConversationCacheBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
