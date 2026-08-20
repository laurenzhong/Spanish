import { expect, test } from "@playwright/test";

test("opens the learning home with one primary action", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/learn$/);
  await expect(
    page.getByRole("heading", { name: "问候后自然继续交流" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "继续学习" })).toHaveCount(1);
  await expect(page.getByText(/选择.*分钟|训练模式/)).toHaveCount(0);
});

test("navigates between all four product areas", async ({ page }) => {
  await page.goto("/learn");

  const navigation = page.getByRole("navigation", { name: "主要导航" });
  await expect(navigation.getByRole("link", { name: "学习" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  for (const destination of [
    { name: "探索", path: "/explore", heading: "探索真实表达" },
    { name: "对话", path: "/chat", heading: "你的西语好友" },
    { name: "我的", path: "/me", heading: "我的进步" },
    { name: "学习", path: "/learn", heading: "问候后自然继续交流" },
  ]) {
    await navigation.getByRole("link", { name: destination.name }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(
      page.getByRole("heading", { name: destination.heading }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: destination.name }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("keeps the shell usable at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn");

  const shell = page.getByTestId("product-shell");
  await expect(shell).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
});
