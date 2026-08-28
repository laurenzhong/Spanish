import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

import { AccountMenu } from "@/src/shared/ui/account-menu";

describe("AccountMenu", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
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

  it("copies the uid with the legacy clipboard fallback", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    render(<AccountMenu />);
    await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
    await user.click(screen.getByRole("button", { name: "复制公开 UID" }));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByRole("status")).toHaveTextContent("UID 已复制");
    Reflect.deleteProperty(document, "execCommand");
  });

  it("logs out and navigates to login", async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(replace).toHaveBeenCalledWith("/login");
    expect(refresh).toHaveBeenCalled();
  });
});
