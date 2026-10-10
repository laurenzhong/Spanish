import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

/**
 * The public home is the only surface an anonymous visitor sees. The entry
 * points and the section headlines are the product claims on that page, so the
 * test pins them to the current landing experience. (`开始第一次练习` belonged to
 * the removed learning hero of `76dba30`; the landing refresh in `3f391c0`
 * replaced that surface, so asserting it here would only pin a dead string.)
 */
describe("public home", () => {
  it("keeps the concept hierarchy and real entry points visible", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "把认识的西语，变成真正说得出口的话。" })).toBeInTheDocument();

    // Every entry point the hero, header and closing section offer.
    expect(screen.getAllByRole("link", { name: /进入学习/ })[0]).toHaveAttribute("href", "/login?next=%2Flearn");
    const publicNavigation = screen.getByRole("navigation", { name: "公开页面导航" });
    expect(within(publicNavigation).getByRole("link", { name: "产品方式" })).toHaveAttribute("href", "#how-it-works");
    expect(within(publicNavigation).getByRole("link", { name: "阅读" })).toHaveAttribute("href", "/login?next=%2Fread");
    expect(within(publicNavigation).getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login");

    expect(screen.getByRole("heading", { name: "每一次练习，都在为下一次真实交流做准备。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "不是题库，是一张可以回来的生活地图。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "你的进步属于你，关系记忆也只在你允许时共享。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "下一句话，从你自己的声音开始。" })).toBeInTheDocument();
  });
});
