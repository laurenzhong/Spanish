"use client";

import { useEffect, useState } from "react";
import { CONVERSATION_LIST_UPDATED_EVENT } from "./conversation-contact-rail";
import { getConversationCacheScope } from "./conversation-cache-scope";

/**
 * How long the navigation badge may keep showing a count it cannot know is
 * still true.
 *
 * The badge used to read the unread count once per mount and afterwards only
 * when a call site happened to announce a list refresh. Two user-visible
 * defects followed from that: a proactive message that arrived while the reader
 * was anywhere except the chat stayed invisible until a full page load, and a
 * conversation that had already been read (in the thread, or in another tab)
 * kept its dot until the next page load. The thread already re-reads on mount,
 * on `focus`, on `visibilitychange` and every 45s; the badge now follows the
 * same cadence, so the dot converges on the server truth on its own.
 */
const UNREAD_REFRESH_INTERVAL_MS = 60_000;

type PendingUnreadRequest = Readonly<{
  promise: Promise<number | null>;
  controller: AbortController;
  generation: number;
  scope: string;
}>;

let cachedUnreadCount = 0;
let cachedScope: string | null = null;
let cacheGeneration = 0;
let unreadRequest: PendingUnreadRequest | null = null;
let queuedRefresh: Promise<number | null> | null = null;
let refreshLoopRunning = false;
let refreshTimer: number | null = null;
let mountedBadgeCount = 0;
// Both navigation bars render this component at once, so the refresh loop and
// its listeners are shared by every mounted badge instead of one per instance.
const subscribers = new Set<() => void>();

function publishUnreadCount(): void {
  for (const subscriber of subscribers) subscriber();
}

export function clearConversationUnreadCache(): void {
  cacheGeneration += 1;
  unreadRequest?.controller.abort();
  unreadRequest = null;
  queuedRefresh = null;
  cachedUnreadCount = 0;
  cachedScope = null;
  publishUnreadCount();
}

function ensureScope(scope: string): void {
  if (cachedScope === scope) return;
  cacheGeneration += 1;
  unreadRequest?.controller.abort();
  unreadRequest = null;
  queuedRefresh = null;
  cachedUnreadCount = 0;
  cachedScope = scope;
}

function isCurrentRequest(promise: Promise<number | null>, generation: number, scope: string): boolean {
  return unreadRequest?.promise === promise
    && unreadRequest.generation === generation
    && unreadRequest.scope === scope
    && cacheGeneration === generation
    && cachedScope === scope;
}

/**
 * Reads the unread count once. Resolves with the count this request produced,
 * or `null` when an account-scope change, a sign-out or a newer refresh
 * invalidated it before it could be applied.
 */
function startUnreadRequest(scope: string): Promise<number | null> {
  const generation = cacheGeneration;
  const controller = new AbortController();
  const request: Promise<number | null> = fetch("/api/v1/conversations", { cache: "no-store", signal: controller.signal })
    .then((response) => response.ok ? response.json() as Promise<{ data?: { conversations?: Array<{ unreadCount?: number }> } }> : Promise.reject(new Error("CONVERSATIONS_UNAVAILABLE")))
    .then((payload) => {
      if (!isCurrentRequest(request, generation, scope)) return null;
      cachedUnreadCount = (payload.data?.conversations ?? []).reduce((total, conversation) => total + Math.max(0, conversation.unreadCount ?? 0), 0);
      publishUnreadCount();
      return cachedUnreadCount;
    })
    .catch(() => null)
    .finally(() => {
      if (unreadRequest?.promise === request) unreadRequest = null;
    });
  unreadRequest = { promise: request, controller, generation, scope };
  return request;
}

/**
 * Reads the unread count, or reuses the read that is already in flight.
 *
 * `fresh` marks a caller that refreshes because the state changed: a read
 * acknowledgement, a list refresh, `focus`, `visibilitychange` or the poll.
 * Such a caller must never be answered by a snapshot taken before its reason to
 * refresh — that is how a dot survived a read acknowledgement that had already
 * been written. When a request is in flight, one follow-up request is queued
 * and shared by every caller that asked meanwhile.
 */
function loadUnreadCount(
  scope = getConversationCacheScope(),
  options: Readonly<{ fresh?: boolean }> = {},
): Promise<number | null> {
  ensureScope(scope);
  if (!unreadRequest) return startUnreadRequest(scope);
  if (!options.fresh) return unreadRequest.promise;
  if (!queuedRefresh) {
    const inFlight = unreadRequest.promise;
    const chained = inFlight
      .then(() => (cachedScope === scope ? startUnreadRequest(scope) : null))
      .finally(() => {
        if (queuedRefresh === chained) queuedRefresh = null;
      });
    queuedRefresh = chained;
  }
  return queuedRefresh;
}

function refreshUnreadCount(): void {
  // A hidden page has nothing to show and the thread pauses too; skip the read
  // instead of paying for it on every timer tick.
  if (document.visibilityState === "hidden") return;
  void loadUnreadCount(getConversationCacheScope(), { fresh: true });
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== "visible") return;
  refreshUnreadCount();
}

/**
 * Restoring a page from the back/forward cache (the usual path when iOS Safari
 * reopens a PWA) does not reliably fire `focus`, so the restored page would
 * otherwise keep the dot it was suspended with.
 */
function handlePageShow(event: PageTransitionEvent): void {
  if (!event.persisted) return;
  refreshUnreadCount();
}

function startRefreshLoop(): void {
  if (refreshLoopRunning) return;
  refreshLoopRunning = true;
  refreshTimer = window.setInterval(refreshUnreadCount, UNREAD_REFRESH_INTERVAL_MS);
  window.addEventListener("focus", refreshUnreadCount);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener(CONVERSATION_LIST_UPDATED_EVENT, refreshUnreadCount);
}

function stopRefreshLoop(): void {
  if (!refreshLoopRunning) return;
  refreshLoopRunning = false;
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
  window.removeEventListener("focus", refreshUnreadCount);
  window.removeEventListener("pageshow", handlePageShow);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener(CONVERSATION_LIST_UPDATED_EVENT, refreshUnreadCount);
}

export function ConversationUnreadBadge() {
  const scope = getConversationCacheScope();
  // The rendered value carries the account scope it was read for, so the render
  // between a scope change and its effect cannot show the previous account's
  // count: a stale scope renders as zero without a synchronous state write.
  const [reading, setReading] = useState<Readonly<{ scope: string; count: number }>>(() => ({
    scope,
    count: cachedScope === scope ? cachedUnreadCount : 0,
  }));

  useEffect(() => {
    ensureScope(scope);
    const subscriber = () => setReading({ scope, count: cachedUnreadCount });
    subscribers.add(subscriber);
    void loadUnreadCount(scope).then(subscriber);
    const signedOut = () => {
      clearConversationUnreadCache();
      setReading({ scope, count: 0 });
    };
    window.addEventListener("account-signed-out", signedOut);
    return () => {
      subscribers.delete(subscriber);
      window.removeEventListener("account-signed-out", signedOut);
    };
  }, [scope]);

  useEffect(() => {
    // One loop for every mounted badge: this component is rendered by both the
    // desktop rail and the phone tab bar.
    mountedBadgeCount += 1;
    startRefreshLoop();
    return () => {
      mountedBadgeCount -= 1;
      if (mountedBadgeCount < 1) stopRefreshLoop();
    };
  }, []);

  // The reading is rendered only for the scope it was read for. During the
  // render between a scope change and its effect this is zero, which is the
  // synchronous privacy guard: the next account's badge never inherits the
  // previous account's count.
  const visibleCount = reading.scope === scope && cachedScope === scope ? reading.count : 0;
  if (visibleCount < 1) return null;
  return <span className="navigation-unread-count" aria-label={`${visibleCount} 条未读消息`}>{visibleCount > 99 ? "99+" : visibleCount}</span>;
}
