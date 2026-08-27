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
  await page.route("**/api/v1/read/word-explanation", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ word: "café", locale: "es-ES", selectionType: "word" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiVersion: "v1", data: {
        partOfSpeech: "名词",
        meaning: "咖啡；也可以指喝咖啡的场所",
        contextualMeaning: "这里指见面的咖啡馆。",
        example: "Nos vemos en el café.",
        provider: "minimax",
        modelVersion: "MiniMax-M3",
        providerRequestId: "e2e-word-explanation",
        latencyMs: 1,
        estimatedCostMicros: null,
      } }),
    });
  });
  await page.goto("/read/article/article.sueno-first-cafe@1");

  const topbar = page.locator(".article-reader__topbar");
  const title = page.locator(".article-reader__topbar-title");
  const actions = page.locator(".article-reader__topbar-actions");
  await expect(topbar).toHaveCSS("position", "fixed");
  await expect(topbar).toHaveCSS("top", "0px");
  await expect(topbar).toHaveCSS("border-bottom-width", "1px");
  await expect(title).toContainText("Una conversación que empieza con un café");
  await expect(title).toHaveCSS("text-overflow", "clip");
  await expect(actions).toHaveCSS("gap", "2px");

  const toggle = page.locator(".article-reader__assist-toggle");
  const tools = page.getByRole("dialog", { name: "阅读辅助" });
  await expect(toggle).toHaveAccessibleName("打开阅读辅助");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tools).not.toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAccessibleName("关闭阅读辅助");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tools).toBeVisible();
  await expect(tools).toContainText("Click any word on the left for a context-aware explanation.");

  const tabs = page.locator(".article-reader__tool-tabs");
  const toolsBox = await tools.boundingBox();
  const tabsBox = await tabs.boundingBox();
  expect(toolsBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  if (toolsBox && tabsBox) {
    expect(tabsBox.y - toolsBox.y).toBeLessThan(80);
    if ((page.viewportSize()?.width ?? 0) >= 960) {
      expect(toolsBox.width).toBeCloseTo(425, 0);
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox).not.toBeNull();
      if (toggleBox) {
        expect(toggleBox.x).toBeGreaterThanOrEqual(toolsBox.x);
        const toggleIsTopmost = await toggle.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === node || node.contains(hit);
        });
        expect(toggleIsTopmost).toBe(true);
      }
      const content = page.locator(".article-reader__content");
      await expect(content).toHaveCSS("padding-right", "24px");
      await expect(content).toHaveCSS("margin-right", "0px");
      const firstTab = tabs.getByRole("tab").first();
      const firstTabBox = await firstTab.boundingBox();
      expect(firstTabBox).not.toBeNull();
      if (firstTabBox) {
        const tabIsTopmost = await firstTab.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === node || node.contains(hit);
        });
        expect(tabIsTopmost).toBe(true);
      }
    }
  }

  if ((page.viewportSize()?.width ?? 0) < 800) {
    await page.locator(".article-reader__tools-close").click();
    await expect(tools).not.toBeVisible();
  }
  await page.getByRole("button", { name: /^café/ }).click();
  await expect(tools).toContainText("这里指见面的咖啡馆。");

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

test("explains a selected sentence", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/read/word-explanation", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ selectionType: "sentence" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiVersion: "v1", data: {
        partOfSpeech: "句子",
        meaning: "下课后，玛尔塔走进校园里的咖啡馆。",
        contextualMeaning: "这句话交代了人物进入咖啡馆的时间、地点和原因。",
        example: "Después de clase, voy a una cafetería.",
        provider: "minimax",
        modelVersion: "MiniMax-M3",
        providerRequestId: "e2e-sentence-explanation",
        latencyMs: 1,
        estimatedCostMicros: null,
      } }),
    });
  });
  await page.goto("/read/article/article.sueno-first-cafe@1");
  await page.locator(".article-reader__assist-toggle").click();
  const paragraph = page.locator('[data-reader-position="0"]');
  const tokens = paragraph.locator(".reader-token");
  const start = await tokens.nth(1).boundingBox();
  const end = await tokens.nth(3).boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  if (!start || !end) throw new Error("sentence tokens missing");
  await page.evaluate(() => {
    document.addEventListener("mouseup", () => {
      document.body.dataset.lastReaderSelection = window.getSelection()?.toString() ?? "";
    }, { capture: true, once: true });
  });
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  const selectedText = await page.locator("body").getAttribute("data-last-reader-selection");
  expect(selectedText).toContain("clase");
  await expect(page.getByRole("button", { name: "解析所选句子" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "阅读辅助" })).toContainText("这句话交代了人物进入咖啡馆的时间、地点和原因。");
});
