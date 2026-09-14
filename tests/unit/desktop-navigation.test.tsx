import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopNavigation, NAVIGATION_STORAGE_KEY } from "@/src/shared/ui/desktop-navigation";
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

  it("uses the viewport default, toggles, and persists the collapsed state", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const user = userEvent.setup();
    render(<DesktopNavigation />);

    const toggle = await screen.findByRole("button", { name: "收起侧边栏" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);

    expect(screen.getByRole("button", { name: "展开侧边栏" })).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem(NAVIGATION_STORAGE_KEY)).toBe("collapsed");
    expect(screen.getByRole("link", { name: "学习" })).toHaveAttribute("aria-current", "page");
  });

  it("honors a stored choice and defaults to collapsed below 1280px", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    render(<DesktopNavigation />);
    await waitFor(() => expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument());

    cleanup();
    window.localStorage.setItem(NAVIGATION_STORAGE_KEY, "expanded");
    render(<DesktopNavigation />);
    await waitFor(() => expect(screen.getByRole("button", { name: "收起侧边栏" })).toBeInTheDocument());
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
