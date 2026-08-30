import { describe, expect, it, vi } from "vitest";

import ProductLayout from "@/app/(product)/layout";

const { cookies, getCurrentUser, headers, redirect } = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentUser: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser,
}));

vi.mock("next/headers", () => ({
  cookies,
  headers,
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

vi.mock("@/src/shared/ui/app-shell", () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));

describe("ProductLayout auth recovery", () => {
  it("keeps transient auth failures on a reloadable state", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    headers.mockResolvedValueOnce(new Headers({ "x-auth-next-path": "/learn" }));
    cookies.mockResolvedValueOnce({
      getAll: () => [{ name: "sb-project-auth-token" }],
    });

    const result = await ProductLayout({ children: "content" });
    expect(result).toMatchObject({
      props: {
        children: expect.objectContaining({
          props: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({ props: { children: "暂时无法验证登录" } }),
            ]),
          }),
        }),
      },
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still redirects a genuinely anonymous request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    headers.mockResolvedValueOnce(new Headers());

    await expect(ProductLayout({ children: "content" })).rejects.toThrow(
      "redirect:/login",
    );
  });

  it("does not hide anonymous traffic when auth checks fail without a session", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    headers.mockResolvedValueOnce(new Headers({ "x-auth-next-path": "/learn" }));
    cookies.mockResolvedValueOnce({ getAll: () => [] });

    await expect(ProductLayout({ children: "content" })).rejects.toThrow(
      "redirect:/login",
    );
  });
});
