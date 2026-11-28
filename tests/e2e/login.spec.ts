import { expect, test } from "@playwright/test";

test("keeps the reading destination when an anonymous reader is sent to login", async ({ page }) => {
  for (const path of ["/read", "/read/vocabulary"]) {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === path);
    await expect(page.getByRole("heading", { name: "¡Bienvenido!" })).toBeVisible();
  }
});

test("keeps the six OTP slots aligned with the accessible input", async ({ page, browserName }) => {
  await page.goto("/login?email=otp-layout%40example.com&step=otp");

  const slots = page.locator(".otp-input__slot");
  await expect(slots).toHaveCount(6);

  const code = page.getByLabel("六位验证码");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).toBeFocused();
  await expect(slots.nth(0)).toHaveAttribute("data-caret", "empty");
  await code.pressSequentially("718");
  await expect(slots.nth(3)).toHaveAttribute("data-caret", "empty");
  await code.pressSequentially("642");
  await expect(slots).toHaveText(["7", "1", "8", "6", "4", "2"]);
  await expect(slots.nth(5)).toHaveAttribute("data-caret", "after");
  await code.press("ArrowLeft");
  await expect(slots.nth(5)).toHaveAttribute("data-caret", "before");
  await code.press("ArrowLeft");
  await expect(slots.nth(4)).toHaveAttribute("data-caret", "before");
  await code.press("End");
  await code.press("Backspace");
  await expect(slots.nth(5)).toHaveAttribute("data-caret", "empty");
  await code.press("ControlOrMeta+A");
  await expect(page.locator('.otp-input__slot[data-selected="true"]')).toHaveCount(5);
  if (browserName === "webkit") {
    // The Windows WebKit runner does not offer Chromium's clipboard grant.
    // Insert the six digits in one input event to exercise committed code fill.
    await page.keyboard.insertText("289135");
  } else {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("289135"));
    await code.press("ControlOrMeta+V");
  }
  await expect(slots).toHaveText(["2", "8", "9", "1", "3", "5"]);
  await expect(slots.nth(5)).toHaveAttribute("data-caret", "after");

  const inputStyles = await code.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      color: styles.color,
      textFillColor: styles.webkitTextFillColor,
      caretColor: styles.caretColor,
      outlineStyle: styles.outlineStyle,
      fontSize: parseFloat(styles.fontSize),
    };
  });
  expect(inputStyles.color).toBe("rgba(0, 0, 0, 0)");
  expect(inputStyles.textFillColor).toBe("rgba(0, 0, 0, 0)");
  expect(inputStyles.caretColor).toBe("rgba(0, 0, 0, 0)");
  expect(inputStyles.outlineStyle).toBe("none");
  expect(inputStyles.fontSize).toBeGreaterThanOrEqual(16);
  await expect(slots.nth(5)).toHaveCSS("outline-style", "solid");

  const boxes = await slots.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    }),
  );

  expect(boxes.every((box) => box.width > 20)).toBe(true);
  expect(boxes.at(-1)!.right - boxes[0].left).toBeGreaterThan(boxes[0].width * 4);
  await page.mouse.click(boxes[2].left + boxes[2].width / 4, (await code.boundingBox())!.y + 20);
  await expect(slots.nth(2)).toHaveAttribute("data-caret", "before");
  await code.press("Tab");
  await expect(page.getByRole("button", { name: "发送验证码", exact: true })).toBeFocused();
  await expect(slots.nth(2)).toHaveCSS("outline-style", "none");
});

test("shows a light inline confirmation below the code label after sending", async ({ page }) => {
  await page.route("**/auth/v1/otp", (route) => route.fulfill({ json: {} }));
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "¡Bienvenido!" })).toHaveAttribute("lang", "es");
  await page.getByLabel("邮箱").fill("otp-layout@example.com");
  await page.getByRole("button", { name: "获取验证码" }).click();

  const notice = page.getByRole("status", { name: "" }).filter({ hasText: "验证码已发送，请查收邮件。" });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCSS("border-left-width", "0px");
  const code = page.getByLabel("六位验证码");
  expect((await notice.boundingBox())!.y).toBeLessThan((await code.boundingBox())!.y);
});

test("keeps the password login form usable and shows a recoverable error", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route("**/auth/v1/token?grant_type=password", (route) => route.fulfill({
    status: 400,
    json: { code: "invalid_credentials", message: "Invalid login credentials" },
  }));
  await page.goto("/login/password");
  await page.getByLabel("邮箱").fill("reviewer@example.test");
  const password = page.getByLabel("密码", { exact: true });
  await password.fill("wrong-test-password");
  await page.getByRole("button", { name: "登录测试账号" }).click();
  await expect(page.locator(".auth-form").getByRole("alert")).toHaveText("邮箱或密码不正确。");
  await expect(password).toHaveValue("wrong-test-password");
  await expect(page.getByRole("button", { name: "登录测试账号" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
