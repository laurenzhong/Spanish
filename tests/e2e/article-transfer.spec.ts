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
  await page.getByText("读完后练口语", { exact: true }).click();
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
  const wideDesktop = (page.viewportSize()?.width ?? 0) >= 1200;
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
  await expect(topbar).toHaveCSS("min-height", "64px");
  await expect(title).toContainText("Una conversación que empieza con un café");
  await expect(title).toHaveCSS("text-overflow", "ellipsis");
  if (wideDesktop) {
    await topbar.evaluate(async (node) => {
      await Promise.all(node.closest(".page-stack")?.getAnimations().map((animation) => animation.finished.catch(() => undefined)) ?? []);
    });
    const centers = await Promise.all([topbar, title].map((locator) => locator.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.left + box.width / 2;
    })));
    expect(Math.abs(centers[0] - centers[1])).toBeLessThan(2);
  }
  await expect(actions.getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Una conversación que empieza con un café" })).toBeVisible();
  await expect(page.getByText("Marta conoce a una compañera nueva en la cafetería del campus y descubre que una conversación sencilla puede abrir una relación inesperada.")).toHaveCount(0);
  await expect(page.getByText("来源已审核")).toHaveCount(0);
  await expect(page.locator(".article-reader__content")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".article-reader__content")).toHaveCSS("box-shadow", "none");
  await expect(page.getByRole("progressbar", { name: "文章阅读进度" })).toBeVisible();

  await expect(page.getByRole("button", { name: "朗读" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收藏" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "解释" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "词典" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "口语" })).toHaveCount(0);
  await expect(page.locator(".article-reader__document-header")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const selectedWord = page.getByRole("button", { name: /^café/ });
  await selectedWord.click();
  await expect(selectedWord).toHaveClass(/is-translation-selection/u);
  const tools = page.getByRole("dialog", { name: "解释" });
  await expect(tools).toContainText("咖啡这种饮料；咖啡馆");
  expect(explanationApiCalled).toBe(false);
  const activeTools = page.getByRole("dialog", { name: "解释" });
  const sidebarOverflow = await activeTools.evaluate((node) => ({ panel: node.scrollWidth <= node.clientWidth }));
  expect(sidebarOverflow.panel).toBe(true);

  if (wideDesktop) {
    const bodyWidthBeforePin = await page.locator(".article-reader__body").evaluate((node) => node.getBoundingClientRect().width);
    const toolsBoxBeforeDrag = await activeTools.boundingBox();
    const dragHandle = page.getByTestId("translator-drag-handle");
    if (toolsBoxBeforeDrag) {
      await dragHandle.hover({ position: { x: 24, y: 20 } });
      await page.mouse.down();
      await page.mouse.move(toolsBoxBeforeDrag.x - 120, toolsBoxBeforeDrag.y + 150);
      await page.mouse.up();
      const toolsBoxAfterDrag = await activeTools.boundingBox();
      expect(toolsBoxAfterDrag?.x).not.toBe(toolsBoxBeforeDrag.x);
    }
    const pin = page.getByRole("button", { name: "固定翻译器" });
    await pin.click();
    await expect(page.locator(".article-reader")).toHaveClass(/article-reader--tools-pinned/u);
    const pinnedBoxes = await Promise.all([page.locator(".article-reader__content"), activeTools].map((locator) => locator.boundingBox()));
    expect(pinnedBoxes[0]).not.toBeNull();
    expect(pinnedBoxes[1]).not.toBeNull();
    if (pinnedBoxes[0] && pinnedBoxes[1]) expect(pinnedBoxes[0].x + pinnedBoxes[0].width).toBeLessThanOrEqual(pinnedBoxes[1].x);
    const bodyWidthAfterPin = await page.locator(".article-reader__body").evaluate((node) => node.getBoundingClientRect().width);
    expect(bodyWidthAfterPin).toBeGreaterThanOrEqual(bodyWidthBeforePin - 1);
    await page.getByRole("heading", { name: "Una conversación que empieza con un café" }).click();
    await expect(activeTools).toBeVisible();
    await page.getByRole("button", { name: "取消固定翻译器" }).click();
    await page.getByRole("heading", { name: "Una conversación que empieza con un café" }).click();
    await expect(activeTools).toHaveCount(0);
    await expect(selectedWord).not.toHaveClass(/is-translation-selection/u);
  } else {
    await expect(page.getByRole("button", { name: "固定翻译器" })).toBeHidden();
    await page.locator(".article-reader__scrim").click({ position: { x: 8, y: 8 } });
  }

  await page.getByRole("button", { name: "朗读" }).click();
  const listenPanel = page.getByRole("dialog", { name: "朗读" });
  await expect(listenPanel).toContainText(/当前：第 \d+ 段/u);
  const currentParagraphText = await listenPanel.textContent();
  const currentParagraph = Number(currentParagraphText?.match(/当前：第 (\d+) 段/u)?.[1]);
  expect(currentParagraph).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: `朗读第 ${currentParagraph} 段` })).toBeVisible();
  await expect(page.locator(`[data-reader-position="${currentParagraph - 1}"]`)).toHaveClass(/is-listen-target/u);
  if (wideDesktop) await page.getByRole("heading", { name: "Una conversación que empieza con un café" }).click();
  else await page.locator(".article-reader__scrim").click({ position: { x: 8, y: 8 } });

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings.getByRole("heading", { name: "Spanish voices" })).toBeVisible();
  await expect(settings.getByRole("region", { name: "Spanish voices" })).toBeVisible();

  if (wideDesktop) await page.getByRole("heading", { name: "Una conversación que empieza con un café" }).click();
  else await page.locator(".article-reader__scrim").click({ position: { x: 8, y: 8 } });
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
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("dialog", { name: "设置" }).waitFor();
  await page.keyboard.press("Escape");
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
    const value = range.toString();
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return value;
  });
  expect(selectedText).toContain("clase");
  await expect(page.getByRole("button", { name: "解析所选句子" })).toHaveCount(0);
  await expect(paragraph.locator(".reader-token.is-translation-selection")).toHaveCount(3);
  await expect(page.getByRole("dialog", { name: "解释" })).toContainText("这句话交代了人物进入咖啡馆的时间、地点和原因。");
});
