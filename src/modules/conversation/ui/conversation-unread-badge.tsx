"use client";

import { useEffect, useState } from "react";
import { CONVERSATION_LIST_UPDATED_EVENT } from "./conversation-contact-rail";
import { getConversationCacheScope } from "./conversation-cache-scope";

let cachedUnreadCount = 0;
let cachedScope: string | null = null;
let cacheGeneration = 0;
type PendingUnreadRequest = Readonly<{
  promise: Promise<void>;
  controller: AbortController;
  generation: number;
  scope: string;
}>;
let unreadRequest: PendingUnreadRequest | null = null;

export function clearConversationUnreadCache(): void {
  cacheGeneration += 1;
  unreadRequest?.controller.abort();
  unreadRequest = null;
  cachedUnreadCount = 0;
  cachedScope = null;
}

function ensureScope(scope: string): void {
  if (cachedScope === scope) return;
  cacheGeneration += 1;
  unreadRequest?.controller.abort();
  unreadRequest = null;
  cachedUnreadCount = 0;
  cachedScope = scope;
}

function loadUnreadCount(scope = getConversationCacheScope()): Promise<void> {
  ensureScope(scope);
  if (unreadRequest) return unreadRequest.promise;
  const generation = cacheGeneration;
  const controller = new AbortController();
  let request: Promise<void>;
  request = fetch("/api/v1/conversations", { cache: "no-store", signal: controller.signal })
    .then((response) => response.ok ? response.json() as Promise<{ data?: { conversations?: Array<{ unreadCount?: number }> } }> : Promise.reject(new Error("CONVERSATIONS_UNAVAILABLE")))
    .then((payload) => {
      if (
        unreadRequest?.promise !== request
        || unreadRequest.generation !== generation
        || unreadRequest.scope !== scope
        || cacheGeneration !== generation
        || cachedScope !== scope
      ) return;
      cachedUnreadCount = (payload.data?.conversations ?? []).reduce((total, conversation) => total + Math.max(0, conversation.unreadCount ?? 0), 0);
    })
    .catch(() => undefined)
    .finally(() => {
      if (unreadRequest?.promise === request) unreadRequest = null;
    });
  unreadRequest = { promise: request, controller, generation, scope };
  return request;
}

export function ConversationUnreadBadge() {
  const scope = getConversationCacheScope();
  const [count, setCount] = useState(() => cachedScope === scope ? cachedUnreadCount : 0);

  useEffect(() => {
    let active = true;
    ensureScope(scope);
    // A scope change must clear the rendered value synchronously. Waiting for
    // the new request would briefly expose the previous account's badge.
    setCount(0);
    void loadUnreadCount(scope).then(() => { if (active && cachedScope === scope) setCount(cachedUnreadCount); });
    const refresh = () => void loadUnreadCount(scope).then(() => { if (active && cachedScope === scope) setCount(cachedUnreadCount); });
    window.addEventListener(CONVERSATION_LIST_UPDATED_EVENT, refresh);
    const signedOut = () => {
      clearConversationUnreadCache();
      if (active) setCount(0);
    };
    window.addEventListener("account-signed-out", signedOut);
    return () => {
      active = false;
      window.removeEventListener(CONVERSATION_LIST_UPDATED_EVENT, refresh);
      window.removeEventListener("account-signed-out", signedOut);
    };
  }, [scope]);

  // Do not render a stale local state during the render between a scope
  // change and its effect. This is the synchronous privacy guard; the effect
  // below then resets state and aborts the old request.
  const visibleCount = cachedScope === scope ? count : 0;
  if (visibleCount < 1) return null;
  return <span className="navigation-unread-count" aria-label={`${visibleCount} 条未读消息`}>{visibleCount > 99 ? "99+" : visibleCount}</span>;
}
