import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailOtpForm } from "@/src/shared/auth/email-otp-form";
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

describe("EmailOtpForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it("moves from email submission to six-digit verification", async () => {
    const auth = repository();
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), " learner@example.test ");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(auth.requestEmailOtp).toHaveBeenCalledWith("learner@example.test");
    expect(await screen.findByLabelText("六位验证码")).toBeVisible();
  });

  it("shows a stable error when sending fails", async () => {
    const auth = repository({
      requestEmailOtp: vi.fn().mockRejectedValue(new Error("network")),
    });
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "learner@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "验证码发送失败，请稍后重试。",
    );
  });
});
