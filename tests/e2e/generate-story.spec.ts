import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: e2eBaseUrl }]);
}

test.describe("Generate Story", () => {
  test("renders the private draft form and reports an unauthenticated response", async ({ page }) => {
    await authenticate(page);
    await page.goto("/read/generate");
    await expect(page.getByRole("heading", { name: "Generate Story" })).toBeVisible();
    await page.getByLabel("主题或提示词").fill("Una tarde en el mercado");
    await page.getByRole("button", { name: "Generate Story" }).click();
    await expect(page.locator(".read-generate__error")).toContainText("生成文章暂时无法保存");
    await expect(page.getByText("AI draft · 仅你可见 · 不计入口语评分")).toBeVisible();
  });
});
