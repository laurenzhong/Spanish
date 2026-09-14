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
    window.localStorage.removeItem("spanish-theme");
    delete document.documentElement.dataset.theme;
  });

  it("keeps the five product destinations visible without a collapse control", () => {
    render(<DesktopNavigation />);

    expect(screen.getByRole("link", { name: "学习" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /侧边栏/ })).not.toBeInTheDocument();
    expect(screen.queryByText("开始")).not.toBeInTheDocument();
    expect(screen.queryByText("发现")).not.toBeInTheDocument();
    expect(screen.queryByText("账户")).not.toBeInTheDocument();
  });

  it("renders icon and text together for each destination", () => {
    render(<DesktopNavigation />);
    expect(screen.getByRole("link", { name: "学习" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: "阅读" }).querySelector("svg")).toBeTruthy();
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
