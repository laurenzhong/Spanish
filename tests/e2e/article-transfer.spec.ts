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

  await expect(page.getByTestId("article-transfer")).toHaveCount(0);
  await page.getByRole("button", { name: "口语" }).click();
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
  let explanationApiCalled = false;
  await page.route("**/api/v1/read/word-explanation", async (route) => {
    explanationApiCalled = true;
    await route.abort();
  });
  await page.goto("/read/article/article.sueno-first-cafe@1");

  const topbar = page.locator(".article-reader__topbar");
  const title = page.locator(".article-reader__topbar-title");
  const actions = page.locator(".article-reader__topbar-actions");
  await expect(topbar).toHaveCSS("position", "fixed");
  await expect(topbar).toHaveCSS("top", "0px");
  await expect(topbar).toHaveCSS("border-bottom-width", "1px");
  await expect(title).toContainText("Una conversación que empieza con un café");
  await expect(title).toHaveCSS("text-overflow", "ellipsis");
  await expect(actions).toHaveCSS("gap", "2px");

  const toggle = page.getByRole("button", { name: "解释" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const tools = page.getByRole("dialog", { name: "解释" });
  await expect(tools).toBeVisible();
  await expect(tools).toContainText("点击正文中的词语查看语境解释。");

  const toolsBox = await tools.boundingBox();
  expect(toolsBox).not.toBeNull();
  if (toolsBox) {
    if ((page.viewportSize()?.width ?? 0) >= 960) {
      expect(toolsBox.width).toBeCloseTo(360, 0);
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox).not.toBeNull();
      if (toggleBox) {
        const toggleIsTopmost = await toggle.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === node || node.contains(hit);
        });
        expect(toggleIsTopmost).toBe(true);
      }
      const content = page.locator(".article-reader__content");
      await expect(content).toHaveCSS("padding-right", "24px");
    }
  }

  if ((page.viewportSize()?.width ?? 0) < 800) {
    await page.locator(".article-reader__tools-close").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("button", { name: /^café/ }).click();
  await expect(tools).toContainText("咖啡这种饮料；咖啡馆");
  expect(explanationApiCalled).toBe(false);
  const activeTools = page.getByRole("dialog", { name: "解释" });
  const sidebarOverflow = await activeTools.evaluate((node) => ({ panel: node.scrollWidth <= node.clientWidth }));
  expect(sidebarOverflow.panel).toBe(true);

  await page.getByRole("button", { name: "词典" }).click();
  await expect(page.getByRole("combobox", { name: "词典源语言" })).toHaveValue("Spanish");
  await expect(page.getByRole("combobox", { name: "词典目标语言" })).toHaveValue("Chinese");
  await expect(page.getByRole("dialog", { name: "词典" })).toContainText("还没有配置 Spanish → Chinese 词典。");

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings.getByRole("heading", { name: "Spanish voices" })).toBeVisible();
  await expect(settings.getByRole("region", { name: "Spanish voices" })).toBeVisible();

  await page.locator(".article-reader__tools-close").click();
  await expect(page.getByRole("button", { name: "设置" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await page.getByRole("button", { name: "解释" }).click();
  const paragraph = page.locator('[data-reader-position="0"]');
  const selectedText = await paragraph.evaluate((node) => {
    const tokens = node.querySelectorAll<HTMLElement>(".reader-token");
    const start = tokens[1]?.firstChild;
    const end = tokens[3]?.firstChild;
    if (!start || !end) throw new Error("sentence tokens missing");
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const value = selection?.toString() ?? "";
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return value;
  });
  expect(selectedText).toContain("clase");
  await expect(page.getByRole("button", { name: "解析所选句子" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "解释" })).toContainText("这句话交代了人物进入咖啡馆的时间、地点和原因。");
});
