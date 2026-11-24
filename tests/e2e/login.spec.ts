import { expect, test } from "@playwright/test";

test("keeps the six OTP slots aligned with the accessible input", async ({ page }) => {
  await page.goto("/login?email=otp-layout%40example.com&step=otp");

  const slots = page.locator(".otp-input__slot");
  await expect(slots).toHaveCount(6);

  await page.getByLabel("六位验证码").fill("718642");
  await expect(slots).toHaveText(["7", "1", "8", "6", "4", "2"]);

  const inputStyles = await page.getByLabel("六位验证码").evaluate((element) => {
    const styles = getComputedStyle(element);
    return { color: styles.color, textFillColor: styles.webkitTextFillColor };
  });
  expect(inputStyles.color).toBe("rgba(0, 0, 0, 0)");
  expect(inputStyles.textFillColor).toBe("rgba(0, 0, 0, 0)");

  const boxes = await slots.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    }),
  );

  expect(boxes.every((box) => box.width > 20)).toBe(true);
  expect(boxes.at(-1)!.right - boxes[0].left).toBeGreaterThan(boxes[0].width * 4);
});
