import { installCorpusExamples } from "./fixtures/corpus-examples";
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
  await expect(page.getByLabel("搜索词表")).toHaveAttribute("placeholder", "搜索单词");
  await expect(page.getByText("7,922 词", { exact: true })).toBeVisible();
  await expect(page.getByText(/已过滤功能词|换设备不会同步|已标记 0 个/u)).toHaveCount(0);
  // The committed reference list remains real even when optional corpus examples are unavailable.
  await expect(page.locator(".vocabulary-study__word")).toHaveCount(7922);
  await expect(page.locator(".vocabulary-study__word").first()).toHaveAttribute("data-word", "ser");
  await expect(page.getByText("部分例句暂时不可用，词表和默写可以继续使用。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "词汇表暂时不可用" })).toHaveCount(0);

  // `?view=` can no longer select behaviour: the same single shelf answers, and
  // the lexicon-only filters are gone with the lexicon view.
  await page.goto("/read/vocabulary?view=lexicon");
  await expect(page.locator(".vocabulary-study__word")).toHaveCount(7922);
  await expect(page.getByLabel("搜索词表")).toBeVisible();
  await expect(page.getByLabel("词元状态")).toHaveCount(0);
  await expect(page.getByLabel("学习状态")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "词汇视图" })).toHaveCount(0);

  await page.goto("/read/phrases");
  await expect(page).toHaveTitle(/短语/u);
  await expect(page.getByRole("heading", { name: "短语", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Qué tal te va?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "阅读内容类型" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "短语交际主题" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索短语" })).toBeVisible();
  await expect(page.getByText("打开来源", { exact: true })).toHaveCount(0);
  await expect(page.locator(".phrasebook-entry")).toHaveCount(120);

  await page.goto("/read/phrases?search=que+tal&intent=revisit&pragmaticPurpose=saludo&register=neutral&region=es-ES&cefr=A2&page=2");
  await expect(page.getByRole("searchbox", { name: "搜索短语" })).toHaveValue("que tal");
  await expect(page.getByRole("heading", { name: "¿Qué tal te va?" })).toBeVisible();
  // Legacy database filters no longer turn the phrasebook into an empty shelf.
  await expect(page.locator('select[name="intent"]')).toHaveCount(0);
});

test("supports local marks and recall without corpus data and keeps search emptiness honest", async ({ page }) => {
  await authenticate(page);
  await page.addInitScript({ content: `localStorage.setItem("sueno:vocabulary-status:v1:00000000-0000-4000-8000-000000000001", JSON.stringify({casa:"familiar"})); localStorage.setItem("sueno:vocabulary-autoplay:v1:00000000-0000-4000-8000-000000000001", "off");` });
  const writes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.method()); });
  await page.goto("/read/vocabulary?search=casa");
  const tile = page.locator('.vocabulary-study__word[data-word="casa"]');
  await expect(tile).toBeVisible();
  await expect(tile).not.toHaveAttribute("data-example");
  await expect(page.locator(".vocabulary-study__summary")).toHaveText("已标记 1 个");
  await page.locator(".vocabulary-recall").getByRole("button", { name: "看释义写单词" }).click();
  const row = tile.locator("..");
  await row.locator("input").fill("casa");
  await row.locator("input").press("Enter");
  await expect(row.getByText("答对了！", { exact: true })).toBeVisible();
  await page.locator(".vocabulary-recall").getByRole("button", { name: "退出默写" }).click();
  await expect(tile).toBeVisible();
  await page.goto("/read/vocabulary?search=zzzz");
  await expect(page.getByRole("heading", { name: "没有匹配的词" })).toBeVisible();
  await expect(page.locator(".vocabulary-study__word")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "词汇表暂时不可用" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("keeps the content-first corpus shelf usable across phone and desktop widths", async ({ page }) => {
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
  await installCorpusExamples(page);
  const requests: string[] = [];
  const evidenceRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/corpus/examples")) requests.push(request.url());
    if (request.url().includes("/api/v1/evidence")) evidenceRequests.push(request.url());
  });
  await page.goto("/read/corpus");
  await expect(page.locator(".corpus-example")).toHaveCount(3);
  expect(requests.some((url) => !new URL(url).searchParams.has("query"))).toBe(true);
  await page.getByRole("searchbox", { name: "搜索西语单词或短语" }).fill("cafe");
  await page.getByRole("button", { name: "查用法" }).click();
  await expect(page.getByText("第 1 / 2 页")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("cafe");
  expect(new URL(page.url()).searchParams.get("match")).toBe("phrase");
  await expect(page.locator(".corpus-example").first().getByRole("link", { name: /读原文：/ })).toHaveAttribute("href", "/read/article/article.sueno-first-cafe%401#segment-1");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("第 2 / 2 页")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("第 1 / 2 页")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  await page.getByRole("button", { name: "同段包含全部词" }).click();
  await expect(page).toHaveURL(/match=all/);
  await expect.poll(() => requests.some((url) => new URL(url).searchParams.get("match") === "all")).toBe(true);
  expect(requests.some((url) => new URL(url).searchParams.get("match") === "phrase")).toBe(true);
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
