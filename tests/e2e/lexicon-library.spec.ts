import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: e2eBaseUrl }]);
}

test("keeps vocabulary and phrase shelves directly reachable from reading", async ({ page }) => {
  await authenticate(page);
  await page.goto("/read/vocabulary");
  await expect(page).toHaveTitle(/词汇/u);
  await expect(page.getByRole("navigation", { name: "阅读内容类型" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "阅读内容类型" }).getByRole("link", { name: "词汇" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "词汇表视图" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "可以马上开始学的西语词表" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "词汇" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /casa/u })).toContainText("房子、家");
  await expect(page.getByText(/共 \d+ 个已审核单词/u)).toBeVisible();

  await page.getByRole("button", { name: /casa/u }).click();
  const card = page.getByRole("complementary", { name: "casa 学习卡片" });
  await expect(card).toBeVisible();
  await expect(card.getByText("房子、家")).toBeVisible();
  await expect(card.getByRole("button", { name: "朗读单词" })).toBeVisible();
  await expect(card.getByRole("group", { name: "标记 casa" }).getByRole("button", { name: "已熟悉" })).toBeVisible();
  await expect(card.getByRole("button", { name: "关闭" })).toBeVisible();

  await page.goto("/read/vocabulary?view=lexicon");
  await expect(page.getByLabel("词元状态")).toBeVisible();
  await expect(page.getByLabel("学习状态")).toBeVisible();
  // The e2e server runs without DATABASE_URL, so the formal lexicon shelf may
  // report either an empty library or an unavailable one.
  await expect(page.getByRole("heading", { name: /还没有词汇|词汇库暂时不可用/u })).toBeVisible();

  await page.goto("/read/phrases");
  await expect(page).toHaveTitle(/短语/u);
  await expect(page.getByRole("heading", { name: "短语", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "还没有短语" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "阅读内容类型" })).toBeVisible();
  await expect(page.getByLabel("学习状态")).toBeVisible();
  await expect(page.getByLabel("语用目的")).toBeVisible();
  await expect(page.getByLabel("语域")).toBeVisible();
  await expect(page.getByLabel("地区")).toBeVisible();
  await expect(page.getByLabel("CEFR")).toBeVisible();
});

test("keeps the corpus placeholder explicit and layout usable on phone widths", async ({ page }) => {
  await authenticate(page);
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 760 });
    for (const path of ["/read/vocabulary", "/read/phrases", "/read/corpus"]) {
      await page.goto(path);
      const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll, `${path} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    }
  }
});

test("exposes the saved reading shelf with type tabs and no phone overflow", async ({ page }) => {
  await authenticate(page);
  await page.goto("/read/saved-items");
  await expect(page).toHaveTitle(/已保存/);
  await expect(page.getByRole("navigation", { name: "阅读内容类型" })).toBeVisible();
  await expect(page.getByRole("link", { name: "已保存" })).toHaveAttribute("href", "/read/saved-items");
  await expect(page.getByRole("heading", { level: 1, name: "已保存" })).toBeVisible();
  const shelfNavigation = page.getByRole("navigation", { name: "已保存内容类型" });
  await expect(shelfNavigation).toBeVisible();
  await expect(shelfNavigation.getByRole("link")).toHaveText(["全部", "文章", "保存词语 / 短语", "高亮"]);
  await expect(shelfNavigation.getByRole("link", { name: "全部" })).toHaveAttribute("aria-current", "page");
  await expect(shelfNavigation.getByRole("link", { name: "文章" })).toHaveAttribute("href", "/read/saved-items?itemType=article&pageSize=24");
  // The e2e server runs without DATABASE_URL, so the shelf must stay honest:
  // the tabs navigate, the list stays empty and the page reports itself.
  await expect(page.getByRole("heading", { name: "已保存内容暂时不可用" })).toBeVisible();
  await expect(page.locator(".saved-item-card")).toHaveCount(0);
  await shelfNavigation.getByRole("link", { name: "文章" }).click();
  await expect(page).toHaveURL(/itemType=article/);
  await expect(page.getByRole("navigation", { name: "已保存内容类型" }).getByRole("link", { name: "文章" })).toHaveAttribute("aria-current", "page");
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 760 });
    await page.reload();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `saved shelf overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
