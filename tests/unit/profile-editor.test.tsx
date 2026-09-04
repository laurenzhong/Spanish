import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileEditor } from "@/app/(product)/me/profile/profile-editor";
import { CHAT_BUBBLE_STYLE_STORAGE_KEY } from "@/src/modules/conversation/ui/chat-bubble-style";

describe("ProfileEditor", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("offers a retry when the profile request is temporarily unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {
          publicUid: "SN-7K4M-9Q2P",
          displayName: "Ana",
          targetLanguage: "es-ES",
          updatedAt: "2026-08-28T08:00:00.000Z",
          avatar: { kind: "initials", presetId: null, url: null, initials: "A", colorIndex: 2 },
        } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ProfileEditor />);
    expect(await screen.findByText("账户资料暂时不可用，请检查网络后重试")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试读取" }));
    expect(await screen.findByDisplayValue("Ana")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets me choose and immediately persist a message bubble style", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {
        publicUid: "SN-7K4M-9Q2P",
        displayName: "Ana",
        targetLanguage: "es-ES",
        updatedAt: "2026-08-28T08:00:00.000Z",
        avatar: { kind: "initials", presetId: null, url: null, initials: "A", colorIndex: 2 },
      } }),
    }));

    const user = userEvent.setup();
    render(<ProfileEditor />);
    expect(await screen.findByRole("heading", { name: "消息气泡" })).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /浅色青蛙/ })).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /浅色青蛙/ }));
    expect(window.localStorage.getItem(CHAT_BUBBLE_STYLE_STORAGE_KEY)).toBe("pink-frog");
    expect(screen.getByRole("radio", { name: /浅色青蛙/ })).toBeChecked();
    expect(screen.getByText("浅色青蛙已应用")).toBeVisible();
  });
});
