import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomNavigation } from "@/src/shared/ui/bottom-navigation";

const usePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

describe("BottomNavigation", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/chat");
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("links every product area and exposes the current item", () => {
    render(<BottomNavigation />);

    expect(screen.getByRole("navigation", { name: "主要导航" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sueño 首页" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "学习" })).toHaveAttribute(
      "href",
      "/learn",
    );
    expect(screen.getByRole("link", { name: "探索" })).toHaveAttribute(
      "href",
      "/explore",
    );
    expect(screen.getByRole("link", { name: "阅读" })).toHaveAttribute(
      "href",
      "/read",
    );
    expect(screen.getByRole("link", { name: "对话" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "我的" })).toHaveAttribute(
      "href",
      "/me",
    );
  });

});
