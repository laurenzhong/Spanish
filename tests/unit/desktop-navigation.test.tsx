import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopNavigation } from "@/src/shared/ui/desktop-navigation";
import { ThemeToggle } from "@/src/shared/ui/theme-toggle";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

vi.mock("@/src/shared/ui/account-menu", () => ({
  AccountMenu: () => <button type="button">账户菜单</button>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DesktopNavigation", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/learn");
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("marks the current area and links every destination", () => {
    render(<DesktopNavigation />);

    // The collapsible-rail control and its stored preference were removed with
    // the UI refresh, so the rail is asserted for what it still guarantees.
    expect(screen.queryByRole("button", { name: /侧边栏/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "学习" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "学习" })).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("link", { name: "阅读" })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("link", { name: "探索" })).toHaveAttribute("href", "/explore");
    expect(screen.getByRole("link", { name: "对话" })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: "我的" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("link", { name: "Sueño 首页" })).toHaveAttribute("href", "/");
  });

  it("treats a nested route as belonging to its area", () => {
    usePathname.mockReturnValue("/read/article/article.one");
    render(<DesktopNavigation />);

    expect(screen.getByRole("link", { name: "阅读" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "学习" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the theme toggle available through the account surface", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "切换到深色模式" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("spanish-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeVisible();
  });

  it("defaults to light even when the operating system prefers dark", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
