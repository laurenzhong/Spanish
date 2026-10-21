import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearConversationUnreadCache,
  ConversationUnreadBadge,
} from "@/src/modules/conversation/ui/conversation-unread-badge";
import {
  CONVERSATION_LIST_UPDATED_EVENT,
  ConversationContactRail,
  clearConversationContactCache,
  markConversationRead,
} from "@/src/modules/conversation/ui/conversation-contact-rail";
import { clearConversationHistoryCache } from "@/src/modules/conversation/ui/conversation-history-cache";

type Deferred<T> = Readonly<{ promise: Promise<T>; resolve: (value: T) => void }>;

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
    status: 200,
    headers: new Headers([["content-type", "application/json"]]),
    json: async () => data,
  } as Response;
}

/** The shape `GET /api/v1/conversations` returns: the badge sums every entry. */
function conversationsPayload(unreadCount: number) {
  return { data: { conversations: [{ unreadCount }] } };
}

function hideDocument(): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
}

function showDocument(): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
}

/**
 * What the reader saw: after already reading Lucía's message the navigation dot
 * came back with "1 unread", and opening the conversation showed nothing newer
 * than the message they had read. Every test below pins one of the two reasons
 * that could happen — the badge kept an answer older than the read, or the read
 * acknowledgement itself was never written.
 */
describe("conversation unread badge freshness", () => {
  afterEach(() => {
    cleanup();
    clearConversationUnreadCache();
    clearConversationContactCache();
    clearConversationHistoryCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("re-reads the unread count when the window regains focus", async () => {
    let unreadCount = 1;
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(conversationsPayload(unreadCount))));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConversationUnreadBadge />);
    expect(await screen.findByLabelText("1 条未读消息")).toBeTruthy();

    // The conversation was read in the thread (or in another tab) while this
    // page stayed open. Coming back to the page must stop showing the dot
    // instead of waiting for a full reload.
    unreadCount = 0;
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.queryByLabelText("1 条未读消息")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not answer a refresh with a request that started before it", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConversationUnreadBadge />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The thread acknowledged the read while the first read was still in flight.
    window.dispatchEvent(new Event(CONVERSATION_LIST_UPDATED_EVENT));
    first.resolve(jsonResponse(conversationsPayload(1)));

    // The acknowledgement must produce a second, later read. Reusing the
    // in-flight snapshot (taken before the read) is what left the dot on screen.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    second.resolve(jsonResponse(conversationsPayload(0)));

    await waitFor(() => expect(screen.queryByLabelText(/条未读消息/u)).toBeNull());
  });

  it("refreshes on visibility change and skips the poll while hidden", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(conversationsPayload(0))));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConversationUnreadBadge />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    hideDocument();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    showDocument();
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("re-reads the count when a cached page is restored", async () => {
    let unreadCount = 1;
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(conversationsPayload(unreadCount))));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConversationUnreadBadge />);
    expect(await screen.findByLabelText("1 条未读消息")).toBeTruthy();

    unreadCount = 0;
    const restored = new Event("pageshow");
    Object.assign(restored, { persisted: true });
    window.dispatchEvent(restored);

    await waitFor(() => expect(screen.queryByLabelText("1 条未读消息")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-reads the contact list when the window regains focus", async () => {
    let unreadCount = 1;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/conversations") {
        return Promise.resolve(jsonResponse({
          data: {
            conversations: [{
              conversationId: "conversation-lucia",
              characterKey: "lucia",
              characterName: "Lucía Martín",
              avatarClass: "avatar--lucia",
              roleLabel: "主要好友",
              lastMessageAt: null,
              lastMessage: null,
              unreadCount,
            }],
          },
        }));
      }
      if (url.endsWith("/introductions")) return Promise.resolve(jsonResponse({ data: { offers: [] } }));
      if (url.endsWith("/lucia-contact")) return Promise.resolve(jsonResponse({ data: { characterKey: "lucia", status: "active" } }));
      return Promise.resolve(jsonResponse({ data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);

    // Without an active character key the rail only reads the list, so this
    // isolates the row badge from the read acknowledgement.
    render(<ConversationContactRail />);
    expect(await screen.findByLabelText("1 条未读消息")).toBeTruthy();

    unreadCount = 0;
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.queryByLabelText("1 条未读消息")).toBeNull());
  });

  it("keeps one refresh loop and one read for both navigation bars", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(conversationsPayload(1))));
    vi.stubGlobal("fetch", fetchMock);
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    const view = render(<>
      <ConversationUnreadBadge />
      <ConversationUnreadBadge />
    </>);
    // The desktop rail and the phone tab bar mount together and still share the
    // mount read, so the badge never doubles the requests per page.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const intervalCalls = setIntervalSpy.mock.calls.filter((call) => call[1] === 60_000);
    expect(intervalCalls).toHaveLength(1);
    // `setInterval` returns the handle; assert the loop is torn down by handle
    // (other environment timers are cleared with unrelated arguments).
    const timerId = setIntervalSpy.mock.results[0]?.value;

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    view.unmount();
    expect(clearIntervalSpy.mock.calls.some((call) => call[0] === timerId)).toBe(true);
  });
});

describe("conversation read acknowledgement", () => {
  afterEach(() => {
    cleanup();
    clearConversationUnreadCache();
    vi.unstubAllGlobals();
  });

  it("retries a failed acknowledgement instead of leaving the conversation unread", async () => {
    const updated: Event[] = [];
    const onUpdated = (event: Event) => { updated.push(event); };
    window.addEventListener(CONVERSATION_LIST_UPDATED_EVENT, onUpdated);
    let attempts = 0;
    const fetchMock = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("network-unavailable"))
        : Promise.resolve(jsonResponse({ data: { characterKey: "lucia", markRead: true } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(markConversationRead("lucia")).resolves.toBe(true);
      expect(attempts).toBe(2);
      // Only a confirmed read may refresh the badge; a silent failure used to
      // leave the count untouched and the dot came back on the next read.
      expect(updated).toHaveLength(1);
    } finally {
      window.removeEventListener(CONVERSATION_LIST_UPDATED_EVENT, onUpdated);
    }
  });

  it("does not retry a stable client refusal", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(() => {
      attempts += 1;
      return Promise.resolve({ ok: false, status: 401, headers: new Headers(), json: async () => ({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(markConversationRead("lucia")).resolves.toBe(false);
    expect(attempts).toBe(1);
  });
});
