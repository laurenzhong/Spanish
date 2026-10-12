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
  await expect(page.getByRole("heading", { level: 1, name: "词汇" })).toHaveCount(1);
  // The vocabulary page is one shelf now: the 学习词表 / 语料高频词 / 正式词元
  // switcher is gone, and so are the study list and the lexicon library it used
  // to switch between.
  await expect(page.getByRole("navigation", { name: "词汇视图" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "词汇表视图" })).toHaveCount(0);
  for (const label of ["学习词表", "语料高频词", "正式词元"]) {
    await expect(page.getByRole("link", { name: label })).toHaveCount(0);
  }
  await expect(page.getByLabel("搜索词表")).toBeVisible();
  // This server runs without DATABASE_URL, so the shelf must report itself
  // rather than invent rows.
  await expect(page.getByRole("heading", { name: "词汇表暂时不可用" })).toBeVisible();

  // `?view=` can no longer select behaviour: the same single shelf answers, and
  // the lexicon-only filters are gone with the lexicon view.
  await page.goto("/read/vocabulary?view=lexicon");
  await expect(page.getByRole("heading", { name: "词汇表暂时不可用" })).toBeVisible();
  await expect(page.getByLabel("搜索词表")).toBeVisible();
  await expect(page.getByLabel("词元状态")).toHaveCount(0);
  await expect(page.getByLabel("学习状态")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "词汇视图" })).toHaveCount(0);

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

  await page.goto("/read/phrases?search=que+tal&intent=revisit&pragmaticPurpose=saludo&register=neutral&region=es-ES&cefr=A2&page=2");
  await expect(page.locator('input[name="search"]')).toHaveValue("que tal");
  await expect(page.locator('select[name="intent"]')).toHaveValue("revisit");
  await expect(page.locator('input[name="pragmaticPurpose"]')).toHaveValue("saludo");
  await expect(page.locator('input[name="register"]')).toHaveValue("neutral");
  await expect(page.locator('input[name="region"]')).toHaveValue("es-ES");
  await expect(page.locator('select[name="cefr"]')).toHaveValue("A2");
});

test("keeps the corpus placeholder explicit and layout usable across phone and desktop widths", async ({ page }) => {
  await authenticate(page);
  for (const width of [320, 375, 414, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    for (const path of ["/read/vocabulary", "/read/phrases", "/read/corpus"]) {
      await page.goto(path);
      const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll, `${path} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    }
  }
});

test("restores corpus matching modes and pagination without recording browsing as evidence", async ({ page }) => {
  await authenticate(page);
  const requests: string[] = [];
  const evidenceRequests: string[] = [];
  await page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/v1/corpus/search")) requests.push(url);
    if (url.includes("/api/v1/evidence")) evidenceRequests.push(url);
  });
  await page.route("**/api/v1/corpus/search*", async (route) => {
    const url = new URL(route.request().url());
    const match = url.searchParams.get("match") ?? "phrase";
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        apiVersion: "v1",
        data: {
          items: [{
            leftContext: pageNumber === 1 ? "No" : "Ya",
            keyword: "dar cuenta",
            rightContext: "de lo ocurrido",
            sourceTitle: `${match === "phrase" ? "Phrase" : "All"} source ${pageNumber}`,
            sourceKind: "article-rss",
            entryKind: "phrase",
            entryId: "20000000-0000-4000-8000-000000000001",
            surfaceText: "dar cuenta",
            document: { kind: "article", stableKey: "article.corpus", version: 2 },
            location: { kind: "text", paragraphId: "p1", segmentIndex: pageNumber - 1 },
          }],
          page: pageNumber,
          pageSize: 1,
          total: 2,
        },
      }),
    });
  });

  await page.goto("/read/corpus");
  await page.getByRole("textbox", { name: "搜索词或短语" }).fill("dar cuenta");
  await page.getByRole("combobox", { name: "匹配方式" }).selectOption("phrase");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.getByText("Phrase source 1")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("dar cuenta");
  expect(new URL(page.url()).searchParams.get("match")).toBe("phrase");
  await expect(page.getByRole("link", { name: "打开来源" })).toHaveAttribute("href", "/read/article/article.corpus#segment-0");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("Phrase source 2")).toBeVisible();

  await page.goBack();
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  await expect(page.getByText("Phrase source 1")).toBeVisible();

  await page.getByRole("combobox", { name: "匹配方式" }).selectOption("all");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.getByText("All source 1")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("match")).toBe("all");
  expect(requests.some((url) => new URL(url).searchParams.get("match") === "phrase")).toBe(true);
  expect(requests.some((url) => new URL(url).searchParams.get("match") === "all")).toBe(true);
  expect(evidenceRequests).toEqual([]);
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
