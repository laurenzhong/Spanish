import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ConversationContactRail direct dragging", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/conversations/preferences")) return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      if (url.includes("/api/v1/character-network/lucia-contact")) return Promise.resolve({ ok: true, json: async () => ({ data: null }) });
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { conversations: [
          { conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null, isPinned: true },
          { conversationId: "c2", characterKey: "mateo", characterName: "Mateo Ruiz", avatarClass: "avatar--mateo", roleLabel: "兴趣好友", lastMessageAt: null, lastMessage: null, isPinned: false },
        ] } }),
      });
    }));
  });

  it("persists the new order when the row is dragged directly", async () => {
    const { ConversationContactRail } = await import("@/src/modules/conversation/ui/conversation-contact-rail");
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());

    const firstRow = screen.getByRole("link", { name: /Lucía Martín/ }).closest("[data-character-key]");
    const secondRow = screen.getByRole("link", { name: /Mateo Ruiz/ }).closest("[data-character-key]");
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();
    const elementFromPoint = vi.fn(() => secondRow);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: elementFromPoint });

    fireEvent.pointerDown(firstRow!, { pointerType: "mouse", button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(firstRow!, { pointerType: "mouse", pointerId: 1, clientX: 20, clientY: 70 });
    fireEvent.pointerUp(firstRow!, { pointerType: "mouse", button: 0, pointerId: 1, clientX: 20, clientY: 70 });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => typeof init?.body === "string" && init.body.includes('"orderedCharacterKeys":["mateo","lucia"]'))).toBe(true));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => typeof init?.body === "string" && init.body.includes('"isPinned":false'))).toBe(true);
    expect(screen.getAllByRole("link").map((link) => link.textContent).join(" ")).toContain("Mateo Ruiz");
  });
});
