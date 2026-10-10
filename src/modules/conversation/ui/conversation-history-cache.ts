import type { ConversationMessage } from "../domain/conversation-state";
import { getConversationCacheScope, isConversationCacheBrowser } from "./conversation-cache-scope";

export type ConversationContactStatus = "pending" | "active" | "declined" | "unavailable";

export type ConversationHistoryAccess = Readonly<{
  readOnly: boolean;
  canSend: boolean;
  contactStatus: ConversationContactStatus | null;
}>;

type ConversationHistoryResponse = Readonly<{
  available: true;
  messages: readonly ConversationMessage[];
  access: ConversationHistoryAccess;
  readOnly: boolean;
  canSend: boolean;
  contactStatus: ConversationContactStatus | null;
}>;

type CachedConversationHistory = Readonly<{
  messages: readonly ConversationMessage[];
  access: ConversationHistoryAccess;
}>;

const DEFAULT_ACCESS: ConversationHistoryAccess = {
  readOnly: false,
  canSend: true,
  contactStatus: null,
};

const historyCache = new Map<string, CachedConversationHistory>();
type PendingHistoryRequest = Readonly<{
  promise: Promise<ConversationHistoryResponse>;
  controller: AbortController;
  generation: number;
}>;

const pendingRequests = new Map<string, PendingHistoryRequest>();
/**
 * A history read is several sequential round trips to the remote database
 * (character runtime, canon facts, messages, contact gate), so its wall-clock
 * time is governed by round-trip latency rather than by query cost: with a
 * remote pooler the request measures 4-8s even though the SQL itself executes
 * in single-digit milliseconds.
 *
 * This bound must therefore stay comfortably above that latency. At 8s an
 * ordinary slow read aborted client-side, and an aborted read is
 * indistinguishable from an unavailable database: the page showed the
 * "cannot open this conversation" notice and locked the composer even though
 * the server still answered 200 with the full history.
 */
const HISTORY_REQUEST_TIMEOUT_MS = 20_000;
let cacheGeneration = 0;
let activeCacheScope: string | null = null;

function cacheKey(characterKey: string, cacheScope = getConversationCacheScope()): string {
  return `${cacheScope}\u0000${characterKey}`;
}

function invalidatePendingRequests(): void {
  cacheGeneration += 1;
  for (const pending of pendingRequests.values()) pending.controller.abort();
  pendingRequests.clear();
}

/**
 * A scope identifies the authenticated browser account. Keeping one active
 * scope and invalidating old requests prevents a late response from a prior
 * account (or a sign-out/sign-in cycle that uses the anonymous test scope)
 * from repopulating the current account's cache.
 */
function ensureCacheScope(cacheScope: string): void {
  if (activeCacheScope === cacheScope) return;
  if (activeCacheScope !== null) {
    historyCache.clear();
    invalidatePendingRequests();
  }
  activeCacheScope = cacheScope;
}

export function getCachedConversationHistory(
  characterKey: string,
  cacheScope = getConversationCacheScope(),
): readonly ConversationMessage[] | null {
  if (!isConversationCacheBrowser()) return null;
  ensureCacheScope(cacheScope);
  return historyCache.get(cacheKey(characterKey, cacheScope))?.messages ?? null;
}

export function getCachedConversationAccess(
  characterKey: string,
  cacheScope = getConversationCacheScope(),
): ConversationHistoryAccess | null {
  if (!isConversationCacheBrowser()) return null;
  ensureCacheScope(cacheScope);
  return historyCache.get(cacheKey(characterKey, cacheScope))?.access ?? null;
}

function normalizeAccess(
  access: Partial<ConversationHistoryAccess> | undefined,
  previous: ConversationHistoryAccess | null,
): ConversationHistoryAccess {
  const readOnly = access?.readOnly ?? previous?.readOnly ?? DEFAULT_ACCESS.readOnly;
  const canSend = readOnly
    ? false
    : access?.canSend ?? previous?.canSend ?? DEFAULT_ACCESS.canSend;
  const contactStatus = access?.contactStatus
    ?? previous?.contactStatus
    ?? DEFAULT_ACCESS.contactStatus;
  return { readOnly, canSend, contactStatus };
}

export function setCachedConversationHistory(
  characterKey: string,
  messages: readonly ConversationMessage[],
  access?: Partial<ConversationHistoryAccess>,
  cacheScope = getConversationCacheScope(),
): void {
  if (!isConversationCacheBrowser()) return;
  ensureCacheScope(cacheScope);
  const completed = messages.filter((message) => message.complete).slice(-100);
  const key = cacheKey(characterKey, cacheScope);
  const previous = historyCache.get(key)?.access ?? null;
  historyCache.set(key, { messages: completed, access: normalizeAccess(access, previous) });
}

export function clearConversationHistoryCache(): void {
  historyCache.clear();
  invalidatePendingRequests();
  activeCacheScope = null;
}

export function loadConversationHistory(
  characterKey: string,
  cacheScope = getConversationCacheScope(),
): Promise<ConversationHistoryResponse> {
  if (!isConversationCacheBrowser()) {
    return Promise.reject(new Error("CONVERSATION_HISTORY_BROWSER_UNAVAILABLE"));
  }
  ensureCacheScope(cacheScope);
  const key = cacheKey(characterKey, cacheScope);
  const pending = pendingRequests.get(key)?.promise;
  if (pending) return pending;

  const generation = cacheGeneration;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), HISTORY_REQUEST_TIMEOUT_MS);
  let request: Promise<ConversationHistoryResponse>;
  request = fetch(`/api/v1/conversations/${characterKey}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal: controller.signal,
  })
    .then(async (response) => {
      if (generation !== cacheGeneration || activeCacheScope !== cacheScope) {
        throw new Error("CONVERSATION_HISTORY_INVALIDATED");
      }
      if (!response.ok) throw new Error("CONVERSATION_HISTORY_UNAVAILABLE");
      const payload = await response.json() as {
        data?: {
          messages?: ConversationMessage[];
          readOnly?: boolean;
          canSend?: boolean;
          contactStatus?: ConversationContactStatus | null;
        };
      };
      const data = payload.data;
      const messages = data?.messages ?? [];
      if (generation !== cacheGeneration || activeCacheScope !== cacheScope) {
        throw new Error("CONVERSATION_HISTORY_INVALIDATED");
      }
      const access = normalizeAccess({
        readOnly: data?.readOnly,
        canSend: data?.canSend,
        contactStatus: data?.contactStatus,
      }, getCachedConversationAccess(characterKey, cacheScope));
      setCachedConversationHistory(characterKey, messages, access, cacheScope);
      return {
        available: true,
        messages,
        access,
        ...access,
      } satisfies ConversationHistoryResponse;
    })
    .finally(() => {
      window.clearTimeout(timeout);
      if (pendingRequests.get(key)?.promise === request) pendingRequests.delete(key);
    });

  pendingRequests.set(key, { promise: request, controller, generation });
  return request;
}

export function prefetchConversationHistory(
  characterKey: string,
  cacheScope = getConversationCacheScope(),
): void {
  if (getCachedConversationHistory(characterKey, cacheScope)) return;
  void loadConversationHistory(characterKey, cacheScope).catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("account-signed-out", clearConversationHistoryCache);
}
