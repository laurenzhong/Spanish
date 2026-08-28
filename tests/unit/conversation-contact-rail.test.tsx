import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

describe("ConversationContactRail", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { conversations: [{ conversationId: "c1", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null }] } }) }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("only shows friends with a persisted conversation", async () => {
    render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mateo Ruiz/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Inés García/ })).not.toBeInTheDocument();
  });

  it("reuses the cached list when the active friend changes", async () => {
    const first = render(<ConversationContactRail activeCharacterKey="lucia" />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Lucía Martín/ })).toBeInTheDocument());
    first.unmount();
    render(<ConversationContactRail activeCharacterKey="mateo" />);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

});
