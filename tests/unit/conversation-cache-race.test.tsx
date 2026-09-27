import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearConversationHistoryCache,
  getCachedConversationHistory,
  loadConversationHistory,
} from "@/src/modules/conversation/ui/conversation-history-cache";
import {
  clearConversationContactCache,
  ConversationContactRail,
} from "@/src/modules/conversation/ui/conversation-contact-rail";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    headers: new Headers([["content-type", "application/json"]]),
    json: async () => data,
  } as Response;
}

function conversation(characterKey: string, characterName: string) {
  return {
    conversationId: `conversation-${characterKey}`,
    characterKey,
    characterName,
    avatarClass: `avatar--${characterKey}`,
    roleLabel: "好友",
    lastMessageAt: null,
    lastMessage: null,
  };
}

describe("conversation cache invalidation", () => {
  afterEach(() => {
    cleanup();
    clearConversationHistoryCache();
    clearConversationContactCache();
    vi.unstubAllGlobals();
  });

  it("does not repopulate history after an in-flight request is invalidated", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const request = loadConversationHistory("lucia", "scope-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearConversationHistoryCache();
    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit] | undefined;
    expect(firstCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect((firstCall?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);

    pending.resolve(jsonResponse({
      data: {
        messages: [{ id: "old-message", role: "character", text: "旧账号消息", complete: true }],
      },
    }));

    await expect(request).rejects.toThrow("CONVERSATION_HISTORY_INVALIDATED");
    expect(getCachedConversationHistory("lucia", "scope-a")).toBeNull();
  });

  it("keeps the new account contact list when the old account response arrives late", async () => {
    const scopeAList = deferred<Response>();
    const scopeBList = deferred<Response>();
    let listRequestCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/conversations") {
        listRequestCount += 1;
        return listRequestCount === 1
          ? scopeAList.promise
          : scopeBList.promise;
      }
      if (url.endsWith("/introductions")) return Promise.resolve(jsonResponse({ data: { offers: [] } }));
      if (url.endsWith("/lucia-contact")) return Promise.resolve(jsonResponse({ data: { characterKey: "lucia", status: "active" } }));
      return Promise.resolve(jsonResponse({ data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<ConversationContactRail activeCharacterKey="lucia" cacheScope="scope-a" />);
    await waitFor(() => expect(listRequestCount).toBe(1));

    view.rerender(<ConversationContactRail activeCharacterKey="lucia" cacheScope="scope-b" />);
    await waitFor(() => expect(listRequestCount).toBe(2));

    scopeBList.resolve(jsonResponse({ data: { conversations: [conversation("mateo", "Mateo Ruiz")] } }));
    expect(await screen.findByRole("link", { name: /Mateo Ruiz/ })).toBeInTheDocument();

    scopeAList.resolve(jsonResponse({ data: { conversations: [conversation("lucia", "Lucía Martín")] } }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("link", { name: /Mateo Ruiz/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Lucía Martín/ })).not.toBeInTheDocument();
  });
});
