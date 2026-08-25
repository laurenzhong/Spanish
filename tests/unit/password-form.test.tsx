import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordForm } from "@/src/shared/auth/password-form";
import type { WebAuthRepository } from "@/src/shared/auth/web-auth-repository";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

function repository(overrides: Partial<WebAuthRepository> = {}) {
  return {
    requestEmailOtp: vi.fn().mockResolvedValue(undefined),
    signInWithPassword: vi.fn().mockResolvedValue(undefined),
    verifyEmailOtp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies WebAuthRepository;
}

describe("PasswordForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it("returns a reviewer to the requested internal page", async () => {
    const auth = repository();
    const user = userEvent.setup();
    render(<PasswordForm repository={auth} redirectTo="/me" />);

    await user.type(screen.getByLabelText("邮箱"), "reviewer@example.test");
    await user.type(screen.getByLabelText("密码"), "secret123");
    await user.click(screen.getByRole("button", { name: "登录测试账号" }));

    expect(auth.signInWithPassword).toHaveBeenCalledWith(
      "reviewer@example.test",
      "secret123",
    );
    expect(replace).toHaveBeenCalledWith("/me");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
