import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailOtpForm } from "@/src/shared/auth/email-otp-form";
import {
  SupabaseWebAuthRepository,
  type WebAuthRepository,
} from "@/src/shared/auth/web-auth-repository";

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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it("requests an OTP and enables free-registration account creation", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const auth = new SupabaseWebAuthRepository({
      auth: { signInWithOtp },
    } as never);

    await auth.requestEmailOtp(" Learner@Example.Test ");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "learner@example.test",
      options: { shouldCreateUser: true },
    });
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

  it("verifies the entered code and navigates to learning", async () => {
    const auth = repository();
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "Learner@Example.Test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    await user.type(screen.getByLabelText("六位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "进入学习" }));

    expect(auth.verifyEmailOtp).toHaveBeenCalledWith(
      "learner@example.test",
      "123456",
    );
    expect(replace).toHaveBeenCalledWith("/learn");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns to the requested internal page after verification", async () => {
    const auth = repository();
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} redirectTo="/chat/lucia" />);

    await user.type(screen.getByLabelText("邮箱"), "learner@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    await user.type(screen.getByLabelText("六位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "进入学习" }));

    expect(replace).toHaveBeenCalledWith("/chat/lucia");
  });

  it("prefills the email from the joined invitation link", () => {
    render(
      <EmailOtpForm
        initialEmail="learner@example.test"
        initialStep="otp"
        repository={repository()}
      />,
    );

    expect(screen.getByLabelText("邮箱")).toHaveValue("learner@example.test");
    expect(screen.getByLabelText("邮箱")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "邀请已激活，请输入邮箱验证码。",
    );
  });

  it("sends the first code from the invitation OTP step, then verifies it", async () => {
    const auth = repository();
    const user = userEvent.setup();
    render(
      <EmailOtpForm
        initialEmail="learner@example.test"
        initialStep="otp"
        repository={auth}
      />,
    );

    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(auth.requestEmailOtp).toHaveBeenCalledWith("learner@example.test");
    expect(
      await screen.findByRole("button", { name: "重新发送（60 秒）" }),
    ).toBeDisabled();

    await user.type(screen.getByLabelText("六位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "进入学习" }));

    expect(auth.verifyEmailOtp).toHaveBeenCalledWith(
      "learner@example.test",
      "123456",
    );
    expect(replace).toHaveBeenCalledWith("/learn");
  });

  it("keeps the verification step available after an invalid code", async () => {
    const auth = repository({
      verifyEmailOtp: vi.fn().mockRejectedValue(new Error("otp_expired")),
    });
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "learner@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));
    await user.type(screen.getByLabelText("六位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "进入学习" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "验证码无效或已经过期，请重新输入。",
    );
    expect(screen.getByLabelText("六位验证码")).toBeVisible();
    expect(screen.queryByRole("button", { name: "获取验证码" })).not.toBeInTheDocument();
  });

  it("explains when the Supabase project disables new account creation", async () => {
    const auth = repository({
      requestEmailOtp: vi.fn().mockRejectedValue({
        code: "signup_disabled",
        message: "Signups not allowed for otp",
        status: 400,
      }),
    });
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "当前未开放新账号创建，请稍后再试或联系所有者。",
    );
    expect(screen.getByLabelText("邮箱")).toHaveValue("new@example.test");
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

  it("explains when Supabase rate-limits a repeated OTP request", async () => {
    const auth = repository({
      requestEmailOtp: vi.fn().mockRejectedValue({
        code: "over_email_send_rate_limit",
        message: "For security purposes, you can only request this after 60 seconds.",
        status: 429,
      }),
    });
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "learner@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "验证码发送太频繁，请等待 60 秒后再试。",
    );
  });

  it("explains invalid email errors from Supabase", async () => {
    const auth = repository({
      requestEmailOtp: vi.fn().mockRejectedValue({
        code: "email_address_invalid",
        status: 422,
      }),
    });
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "learner@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "邮箱地址无效，请检查后重试。",
    );
  });

  it("explains when the auth service cannot be reached", async () => {
    const auth = repository({
      requestEmailOtp: vi.fn().mockRejectedValue({
        name: "AuthRetryableFetchError",
        message: "Failed to fetch",
      }),
    });
    const user = userEvent.setup();
    render(<EmailOtpForm repository={auth} />);

    await user.type(screen.getByLabelText("邮箱"), "learner@example.test");
    await user.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法连接认证服务，请检查网络后重试。",
    );
  });

  it("counts down the resend cooldown and clears its timer on unmount", async () => {
    vi.useFakeTimers();
    const auth = repository();
    const view = render(<EmailOtpForm repository={auth} />);

    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "learner@example.test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    });

    expect(
      screen.getByRole("button", { name: "重新发送（60 秒）" }),
    ).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(
      screen.getByRole("button", { name: "重新发送（59 秒）" }),
    ).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(
      screen.getByRole("button", { name: "重新发送（58 秒）" }),
    ).toBeDisabled();

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
