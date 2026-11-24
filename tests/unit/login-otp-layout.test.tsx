import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OtpInput } from "@/src/shared/ui/primitives";

describe("OTP login layout", () => {
  it("renders one visual slot for each digit", () => {
    const { container } = render(
      <OtpInput aria-label="六位验证码" id="otp" length={6} onChange={vi.fn()} value="" />,
    );

    expect(container.querySelectorAll(".otp-input__slot")).toHaveLength(6);
  });
});
