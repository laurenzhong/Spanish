import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("public home", () => {
  it("keeps the concept hierarchy and real entry points visible", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "把认识的西语，变成真正说得出口的话。" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "进入学习" })[0]).toHaveAttribute("href", "/login?next=%2Flearn");
    expect(screen.getByRole("link", { name: "产品方式" })).toHaveAttribute("href", "#how-it-works");
    expect(screen.getByRole("heading", { name: "每一次练习，都在为下一次真实交流做准备。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "你的进步属于你，关系记忆也只在你允许时共享。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "下一句话，从你自己的声音开始。" })).toBeInTheDocument();
  });
});
