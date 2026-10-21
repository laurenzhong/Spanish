import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";

const items = [
  { key: "one", label: "一", href: "/one", current: true },
  { key: "two", label: "二", href: "/two" },
  { key: "three", label: "三", href: "/three" },
];

function mockGeometry(hiddenIndexes: readonly number[] = []) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("test-navigation")) return { left: 0, width: 300 } as DOMRect;
    if (this.tagName !== "A") return { left: 0, width: 0 } as DOMRect;
    const links = Array.from(this.parentElement?.querySelectorAll("a") ?? []);
    const index = links.indexOf(this as HTMLAnchorElement);
    // jsdom has no layout engine, so hidden items (phone widths drop some
    // destinations) report the zero-width box a browser would report.
    return hiddenIndexes.includes(index) ? { left: 0, width: 0 } as DOMRect : { left: index * 60, width: 60 } as DOMRect;
  });
}

describe("slideable navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rests on the current item and follows the pointer, then returns", () => {
    mockGeometry();
    const { container } = render(<SlideableNavigation className="test-navigation" label="测试导航" items={items} activeKey="two" />);
    const navigation = screen.getByRole("navigation", { name: "测试导航" });
    const indicator = container.querySelector(".slideable-navigation__indicator");

    expect(navigation).toHaveAttribute("data-indicator", "ready");
    expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("aria-current"))).toEqual(["page", null, null]);
    expect(indicator).toHaveStyle({ transform: "translateX(60px) translateY(0px)", width: "60px", opacity: "1" });

    const links = within(navigation).getAllByRole("link");
    links[2].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(indicator).toHaveStyle({ transform: "translateX(120px) translateY(0px)", width: "60px" });

    links[2].dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(indicator).toHaveStyle({ transform: "translateX(60px) translateY(0px)" });
  });

  it("falls back to the first visible item when the current item is hidden", () => {
    mockGeometry([0, 1]);
    const { container } = render(<SlideableNavigation className="test-navigation" label="测试导航" items={items} activeKey="one" />);
    const indicator = container.querySelector(".slideable-navigation__indicator");
    // The first two destinations are hidden on phone widths, so the underline
    // must land on the first item somebody can actually see (the third one),
    // not park itself off-screen on the hidden first item.
    expect(indicator).toHaveStyle({ transform: "translateX(120px) translateY(0px)", width: "60px" });
  });

  it("keeps the resting underline hidden for a header with no current item", () => {
    mockGeometry();
    const headerItems = [
      { key: "how-it-works", label: "产品方式", href: "#how-it-works" },
      { key: "read", label: "阅读", href: "/login?next=%2Fread" },
      { key: "login", label: "登录", href: "/login" },
    ];
    const { container } = render(<SlideableNavigation className="test-navigation" label="公开页面导航" items={headerItems} restingIndicator="hidden" />);
    const navigation = screen.getByRole("navigation", { name: "公开页面导航" });
    const indicator = container.querySelector(".slideable-navigation__indicator");

    // The resting box is still measured, so the underline is already in place
    // the instant the pointer or keyboard arrives; only its visibility rests.
    // A resting underline on a header reads as a current-page marker for a page
    // nobody is on — on phone widths the only visible item is 登录.
    expect(indicator).toHaveStyle({ transform: "translateX(0px) translateY(0px)", width: "60px", opacity: "0" });

    const links = within(navigation).getAllByRole("link");
    links[1].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(indicator).toHaveStyle({ transform: "translateX(60px) translateY(0px)", opacity: "1" });

    links[1].dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(indicator).toHaveStyle({ opacity: "0" });
  });

  it("hands a click to the caller that loads the destination itself", () => {
    mockGeometry();
    const onSelect = vi.fn();
    render(<SlideableNavigation className="test-navigation" label="测试导航" items={items} activeKey="one" onSelect={onSelect} />);
    const links = within(screen.getByRole("navigation", { name: "测试导航" })).getAllByRole("link");

    // The caller takes the click over, so the browser must not also follow the href.
    const handled = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[2].dispatchEvent(handled);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "three" }));
    expect(handled.defaultPrevented).toBe(true);

    // A caller that declines the click leaves the href alone.
    onSelect.mockReturnValueOnce(false);
    const unhandled = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[1].dispatchEvent(unhandled);
    expect(unhandled.defaultPrevented).toBe(false);
  });
});
