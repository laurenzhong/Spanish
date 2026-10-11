import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { clearConversationHistoryCache } from "@/src/modules/conversation/ui/conversation-history-cache";
import {
  ConversationContactRail,
  clearConversationContactCache,
} from "@/src/modules/conversation/ui/conversation-contact-rail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type FetchCall = Readonly<{ url: string; method: string; body: string | null }>;

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers([["content-type", "application/json"]]),
    json: async () => data,
  } as Response;
}

/**
 * Answers every conversation request with a fixed, already-known payload so the
 * assertions are about request behaviour (who marks what read, how often) rather
 * than about the server.
 */
function stubConversationFetch(unreadCount: number, calls: FetchCall[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
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
    if (url === "/api/v1/conversations/preferences") {
      return Promise.resolve(jsonResponse({ data: { characterKey: "lucia", markRead: true } }));
    }
    if (url.endsWith("/introductions")) return Promise.resolve(jsonResponse({ data: { offers: [] } }));
    if (url.endsWith("/lucia-contact")) return Promise.resolve(jsonResponse({ data: { characterKey: "lucia", status: "active" } }));
    return Promise.resolve(jsonResponse({ data: { characterKey: "lucia", messages: [] } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function markReadCalls(calls: readonly FetchCall[]): readonly FetchCall[] {
  return calls.filter((call) => call.url === "/api/v1/conversations/preferences" && call.method === "PATCH");
}

describe("conversation read acknowledgement", () => {
  afterEach(() => {
    cleanup();
    clearConversationHistoryCache();
    clearConversationContactCache();
    vi.unstubAllGlobals();
    document.querySelector("[data-conversation-cache-scope]")?.remove();
    document.querySelector("[data-conversation-history-scope]")?.remove();
  });

  it("marks the open conversation read when the thread loads", async () => {
    const calls: FetchCall[] = [];
    stubConversationFetch(4, calls);

    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} initialMessages={[]} />);

    await waitFor(() => expect(markReadCalls(calls).length).toBeGreaterThan(0));
    expect(JSON.parse(markReadCalls(calls)[0].body ?? "{}")).toEqual({ characterKey: "lucia", markRead: true });
  });

  it("marks a conversation read once per unread count instead of once per list refetch", async () => {
    const calls: FetchCall[] = [];
    stubConversationFetch(4, calls);

    render(<ConversationContactRail activeCharacterKey="lucia" />);

    await waitFor(() => expect(markReadCalls(calls).length).toBe(1));
    // The list refetches several times while the rail mounts; a stable unread
    // count must not produce one patch per refetch.
    await waitFor(() => expect(calls.filter((call) => call.url === "/api/v1/conversations").length).toBeGreaterThan(1));
    expect(markReadCalls(calls)).toHaveLength(1);
  });

  it("anchors the navigation unread badge to the icon's top-right corner", () => {
    // Normalise CRLF so the multi-line selector assertions are line-ending agnostic.
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");
    const base = css.match(/\.navigation-unread-count \{([^}]*)\}/)?.[1] ?? "";
    // The badge is anchored to the icon itself (the icon containers are the
    // positioning context), so icon size, label presence and the expanded or
    // collapsed rail all inherit one pair of offsets instead of three sets of
    // pixel magic numbers tied to the width of the whole navigation link.
    expect(css).toContain(".navigation-icon {\n  position: relative;");
    expect(css).toContain(".desktop-navigation__icon {\n    position: relative;");
    expect(base).toContain("inset-block-start: -3px");
    expect(base).toContain("inset-inline-end: -9px");
    // A 20px box with a 1.5px ring paints an 18px red disc for one digit, and a
    // "99+" label grows the same box into a pill. Note there is deliberately no
    // `aspect-ratio` here: stacking it on the padded box also squashed the
    // three-character label (the text escaped the circle), which is worse than
    // the oval it was meant to fix.
    expect(base).toContain("min-width: 20px");
    expect(base).toContain("border: 1.5px solid var(--surface, #fff)");
    expect(base).not.toContain("aspect-ratio");
    // Wide desktop rail: same visual relationship as the phone — the fill bites
    // into the icon's top-right corner by roughly the same share of the glyph
    // width (measured at 1440px).
    expect(css).toContain(".desktop-navigation__link .navigation-unread-count { inset-block-start: -5px; inset-inline-end: -7px;");
    expect(css).toContain('.desktop-navigation__link .navigation-unread-count { inset-block-start: -3px; inset-inline-end: -10px; }');
  });

  it("draws both unread badges from the notification tokens instead of hardcoded red", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");
    // One semantic token layer for the light theme and one dark pairing, per
    // docs/superpowers/specs/2026-08-26-web-ui-design-research-and-scheme.md:117.
    expect(css).toContain("--notification: #d92d3f;");
    expect(css).toContain("--notification-soft: #d9363e;");
    expect(css).toContain("--notification-ink: #ffffff;");
    expect(css).toMatch(/:root\[data-theme="dark"\][\s\S]*?--notification: #e2606f;[\s\S]*?--notification-ink: #231310;/);
    // The two previously hardcoded reds and their white text must be gone; they
    // may only still appear as token definitions in the light :root block.
    const hexReds = css.match(/#d92d3f|#d9363e/g) ?? [];
    expect(hexReds).toHaveLength(2);
    expect(css).not.toMatch(/color: #fff;\s*\n\s*background: #d9363e/);
    const navBadge = css.match(/\.navigation-unread-count \{([^}]*)\}/)?.[1] ?? "";
    expect(navBadge).toContain("background: var(--notification)");
    expect(navBadge).toContain("color: var(--notification-ink)");
    const listBadge = css.match(/\.conversation-contact-row__unread-count \{([^}]*)\}/)?.[1] ?? "";
    expect(listBadge).toContain("background: var(--notification-soft)");
    expect(listBadge).toContain("color: var(--notification-ink)");
  });
});
