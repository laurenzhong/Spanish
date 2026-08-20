import { expect, test, type Page } from "@playwright/test";

const e2eUserId = "00000000-0000-4000-8000-000000000001";

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: e2eUserId,
      domain: "localhost",
      path: "/",
    },
  ]);
}

test("shows the public introduction without requiring a session", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", {
      name: "把认识的西班牙语，变成真正说得出口的表达。",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "开始学习" })).toBeVisible();
});

test("redirects anonymous product traffic to email OTP login", async ({
  page,
}) => {
  await page.goto("/learn");

  await expect(page).toHaveURL(/\/login\?next=%2Flearn$/);
  await expect(
    page.getByRole("heading", { name: "用邮箱接收验证码" }),
  ).toBeVisible();
});

test("navigates between all four product areas", async ({ page }) => {
  await authenticate(page);
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
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn");

  const shell = page.getByTestId("product-shell");
  await expect(shell).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
});

test("returns the authenticated session through the versioned API", async ({
  page,
}) => {
  await authenticate(page);

  const response = await page.request.get("/api/v1/auth/session");
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({
    apiVersion: "v1",
    data: { userId: e2eUserId, email: "e2e@example.test" },
  });
});
