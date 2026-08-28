import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/src/shared/ui/account-menu";

describe("AccountMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { publicUid: "SN-7K4M-9Q2P", displayName: "Ana", targetLanguage: "es-ES", avatar: { kind: "initials", presetId: null, url: null, initials: "A", colorIndex: 2 }, updatedAt: "2026-08-28T08:00:00.000Z" } }) }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows identity, uid and low-frequency account actions", async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
    expect((await screen.findAllByText("Ana")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("SN-7K4M-9Q2P")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /编辑个人资料/ })).toHaveAttribute("href", "/me/profile");
    expect(screen.queryByText("好友")).toBeNull();
  });
});
