import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: e2eBaseUrl,
  }]);
}

async function mockEmptyMediaLibrary(page: Page) {
  await page.route("**/api/v1/media?*", (route) => route.fulfill({ json: {
    apiVersion: "v1", data: { items: [] }, page: { hasMore: false, nextCursor: null },
  } }));
}

test("does not fabricate media when the publishable library is empty", async ({ page }) => {
  await authenticate(page);
  await mockEmptyMediaLibrary(page);
  await page.goto("/learn");

  await expect(page.getByRole("heading", { name: "媒体资料库暂时无法读取" })).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator("article.media-card")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeVisible();
  await expect(page.getByText("不会用示例卡片冒充真实内容", { exact: false })).toBeVisible();
});

test("switches media type through a stable deep link", async ({ page }) => {
  await authenticate(page);
  await mockEmptyMediaLibrary(page);
  await page.goto("/learn");
  await page.getByRole("link", { name: "播客" }).click();

  await expect(page).toHaveURL(/\/learn\?kind=podcast$/);
  await expect(page.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
});
