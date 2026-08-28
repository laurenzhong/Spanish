import type { ConversationMessage } from "../domain/conversation-state";

type ConversationHistoryResponse = Readonly<{
  available: true;
  messages: readonly ConversationMessage[];
}>;

const historyCache = new Map<string, readonly ConversationMessage[]>();
const pendingRequests = new Map<string, Promise<ConversationHistoryResponse>>();

export function getCachedConversationHistory(characterKey: string): readonly ConversationMessage[] | null {
  return historyCache.get(characterKey) ?? null;
}

export function setCachedConversationHistory(characterKey: string, messages: readonly ConversationMessage[]): void {
  const completed = messages.filter((message) => message.complete).slice(-100);
  historyCache.set(characterKey, completed);
}

export function clearConversationHistoryCache(): void {
  historyCache.clear();
  pendingRequests.clear();
}

export function loadConversationHistory(characterKey: string): Promise<ConversationHistoryResponse> {
  const pending = pendingRequests.get(characterKey);
  if (pending) return pending;

  const request = fetch(`/api/v1/conversations/${characterKey}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("CONVERSATION_HISTORY_UNAVAILABLE");
      const payload = await response.json() as { data?: { messages?: ConversationMessage[] } };
      const messages = payload.data?.messages ?? [];
      setCachedConversationHistory(characterKey, messages);
      return { available: true, messages } satisfies ConversationHistoryResponse;
    })
    .finally(() => pendingRequests.delete(characterKey));

  pendingRequests.set(characterKey, request);
  return request;
}

export function prefetchConversationHistory(characterKey: string): void {
  if (getCachedConversationHistory(characterKey)) return;
  void loadConversationHistory(characterKey).catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("account-signed-out", clearConversationHistoryCache);
}
