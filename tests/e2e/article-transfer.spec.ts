import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: "00000000-0000-4000-8000-000000000001",
      url: e2eBaseUrl,
    },
  ]);
}

test("moves an explicit article transfer into the oral practice context", async ({ page }) => {
  await authenticate(page);
  await page.goto("/read/article/article.sueno-first-cafe@1");

  await expect(page.getByTestId("article-transfer")).toBeVisible();
  await expect(page.getByRole("button", { name: /说说文章讲了什么/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /说说你的看法/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /联系到自己的生活/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /和角色聊两句/ })).toBeVisible();

  await page.getByRole("button", { name: /说说你的看法/ }).click();
  await expect(page.getByLabel("口语迁移草稿")).toBeVisible();
  await expect(page.getByRole("link", { name: "进入口语复核" })).toHaveAttribute(
    "href",
    "/learn/practice?article=article.sueno-first-cafe%401&transfer=opinion",
  );

  await page.getByRole("link", { name: "进入口语复核" }).click();
  await expect(page).toHaveURL(/\/learn\/practice\?article=article\.sueno-first-cafe%401&transfer=opinion$/);
  await expect(page.getByTestId("article-transfer-context")).toContainText("说说你的看法");
  await expect(page.getByTestId("article-transfer-context")).toContainText("只有你主动用声音回答时");
});

test("opens reader tools on demand and explains a selected word", async ({ page }) => {
  await authenticate(page);
  await page.goto("/read/article/article.sueno-first-cafe@1");

  const toggle = page.locator(".article-reader__assist-toggle");
  const tools = page.getByRole("complementary", { name: "阅读辅助" });
  await expect(toggle).toHaveAccessibleName("打开阅读辅助");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tools).not.toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAccessibleName("关闭阅读辅助");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tools).toBeVisible();
  await expect(tools).toContainText("Click any word on the left for a context-aware explanation.");

  if ((page.viewportSize()?.width ?? 0) < 800) {
    await page.locator(".article-reader__tools-close").click();
    await expect(tools).not.toBeVisible();
  }
  await page.getByRole("button", { name: /^café/ }).click();
  await expect(tools).toContainText("咖啡；也可以指喝咖啡的场所");

  await page.getByRole("tab", { name: "Dictionary" }).click();
  await expect(page.getByRole("combobox", { name: "词典源语言" })).toHaveValue("Spanish");
  await expect(page.getByRole("combobox", { name: "词典目标语言" })).toHaveValue("Chinese");
  await expect(tools).toContainText("还没有配置 Spanish → Chinese 词典。");

  if ((page.viewportSize()?.width ?? 0) < 800) await page.locator(".article-reader__tools-close").click();
  else await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("打开阅读辅助");
  await expect(tools).not.toBeVisible();
});
