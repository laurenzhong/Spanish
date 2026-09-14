import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: e2eBaseUrl,
  }]);
}

test("does not fabricate media when the publishable library is empty", async ({ page }) => {
  await authenticate(page);
  await page.goto("/learn");

  await expect(page.locator("article.media-card")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeVisible();
  await expect(page.getByText("不会用示例卡片冒充真实内容", { exact: false })).toBeVisible();
});

test("switches media type through a stable deep link", async ({ page }) => {
  await authenticate(page);
  await page.goto("/learn");
  await page.getByRole("link", { name: "播客" }).click();

  await expect(page).toHaveURL(/\/learn\?kind=podcast$/);
  await expect(page.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
});
