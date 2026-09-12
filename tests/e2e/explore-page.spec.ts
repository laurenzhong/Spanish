import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

test("renders the desktop discovery workspace with published content", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/explore");

  await expect(page.getByRole("heading", { name: "探索真实表达" })).toHaveClass(/sr-only/u);
  await expect(page.getByRole("link", { name: "练习历史" })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "探索内容" }).getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "场景" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: /校园办事/ })).toBeVisible();
  await expect(page.getByText("14 项匹配")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
});

test("restores a device-only save after sync failure without hydration mismatch", async ({ page }) => {
  await authenticate(page);
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated but some attributes")) {
      hydrationErrors.push(message.text());
    }
  });
  await page.goto("/explore");
  await page.getByRole("tab", { name: "内容包" }).click();

  await page.getByRole("button", { name: "保存咖啡馆里的新朋友" }).click();
  await expect(page.getByText("已保存在本设备，账号同步失败，可重试。")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "内容包" }).click();
  await expect(page.getByRole("button", { name: "取消保存咖啡馆里的新朋友" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "取消保存咖啡馆里的新朋友" }).click();
  await expect(page.getByText("已从本设备移除，账号同步失败。")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "内容包" }).click();
  await expect(page.getByRole("button", { name: "保存咖啡馆里的新朋友" })).toHaveAttribute("aria-pressed", "false");
  expect(hydrationErrors).toEqual([]);
});

test("searches the full library without accents and restores filters from the URL", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore?q=como");

  await expect(page.getByRole("searchbox")).toHaveValue("como");
  await page.getByRole("tab", { name: "表达" }).click();
  await expect(page.getByRole("heading", { name: "¿Cómo va todo?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^阅读来源/u })).toHaveCount(0);
  await page.getByRole("button", { name: "筛选表达" }).click();
  await page.getByRole("button", { name: /^阅读来源/u }).click();
  await expect(page).toHaveURL(/(?:\?|&)filter=reading(?:&|$)/u);
  await page.reload();
  await expect(page.getByRole("tab", { name: "表达" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("阅读来源 ×")).toBeVisible();

  await page.getByRole("searchbox").fill("完全不存在的场景");
  await expect(page.getByText("没有匹配的表达")).toBeVisible();
  await page.getByRole("button", { name: "清除搜索和筛选" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByText("¿Cómo va todo?")).toBeVisible();
});

test("enters private generation from a saved library expression and restores focus", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/expressions/saved", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ apiVersion: "v1", data: { id: "10000000-0000-4000-8000-000000000001" } }),
    });
  });
  await page.route("**/api/v1/scenarios", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiVersion: "v1", data: { scenarios: [], generationSources: { savedExpressions: [], readingHighlights: [], recentErrors: [] }, generationAvailable: true } }),
    });
  });
  await page.goto("/explore?q=como");
  await page.getByRole("tab", { name: "表达" }).click();

  await page.getByRole("button", { name: "收藏表达：¿Cómo va todo?" }).click();
  await expect(page.getByText("已收藏表达，不会产生学习证据。")).toBeVisible();
  const generatorTrigger = page.getByRole("button", { name: "用此表达生成场景：¿Cómo va todo?" });
  await generatorTrigger.click();
  await expect(page.getByText("已从表达库选择")).toBeVisible();
  await expect(page.getByRole("radio", { name: /用收藏表达/u })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "关闭私人场景生成" }).click();
  await expect(generatorTrigger).toBeFocused();
});

test("suggests and swaps an explainable scenario without requiring a search query", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let call = 0;
  const requests: Array<{ excludedScenarioIds?: string[] }> = [];
  await page.route("**/api/v1/explore/scenario-suggestions", async (route) => {
    call += 1;
    requests.push(route.request().postDataJSON() as { excludedScenarioIds?: string[] });
    const scenario = call === 1
      ? { stableKey: "scenario.campus-administration", title: "校园办事：注册与材料", description: "在学校行政窗口说明来意。", cefr: "A2", category: "study", categoryLabel: "学习办事", role: "校园行政工作人员", communicationGoal: "说明来意并确认材料", sourceKind: "public", route: "/explore/scenarios/scenario.campus-administration" }
      : { stableKey: "scenario.restaurant-ordering", title: "餐厅沟通：点单与饮食限制", description: "在餐厅完成点单并确认饮食限制。", cefr: "A2", category: "daily-life", categoryLabel: "日常生活", role: "餐厅服务员", communicationGoal: "完成点单并确认配料", sourceKind: "public", route: "/explore/scenarios/scenario.restaurant-ordering" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiVersion: "v1", data: { requestId: `request-${call}2345678`, suggestionSessionId: "session-12345678", scenario, reasons: [{ code: call === 1 ? "new-category" : "fresh-scenario", text: call === 1 ? "你还没有练过学习办事类场景。" : "这是近期没有出现过的场景。" }], eligibleCount: 3, canSwap: true, limitReached: false, fallback: null } }),
    });
  });

  await page.goto("/explore");
  await expect(page.getByRole("button", { name: /适合我的/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /探索新场景/ })).toBeVisible();
  await page.getByRole("button", { name: /随机来一个/ }).click();
  const suggestion = page.getByLabel("场景建议");
  await expect(suggestion.getByRole("heading", { name: "校园办事：注册与材料" })).toBeVisible();
  await expect(page.getByText("你还没有练过学习办事类场景。")).toBeVisible();
  await expect(page.getByRole("link", { name: "开始练习" })).toHaveAttribute("href", "/explore/scenarios/scenario.campus-administration");
  await page.getByRole("button", { name: "换一个" }).click();
  await expect(suggestion.getByRole("heading", { name: "餐厅沟通：点单与饮食限制" })).toBeVisible();
  expect(requests[1]?.excludedScenarioIds).toEqual(["scenario.campus-administration"]);
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});

test("offers explicit source choices and generates a private scenario only after confirmation", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let generationRequest: { header: string | undefined; body: { source?: { sourceType?: string; topic?: string } } } | null = null;
  await page.route("**/api/v1/explore/scenario-suggestions", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { requestId: "request-12345678", suggestionSessionId: "session-12345678", scenario: null, reasons: [], eligibleCount: 0, canSwap: false, limitReached: false, fallback: { canGeneratePersonalScenario: true, topicChips: ["日常生活", "学习办事", "社交沟通"] } } }) }));
  await page.route("**/api/v1/scenarios", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { scenarios: [], generationSources: { savedExpressions: [{ id: "10000000-0000-4000-8000-000000000001", label: "Quisiera pedir ayuda.", detail: "我想请求帮助。" }], readingHighlights: [], recentErrors: [] }, generationAvailable: true } }) }));
  await page.route("**/api/v1/scenarios/generate", async (route) => {
    generationRequest = { header: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() as { source?: { sourceType?: string; topic?: string } } };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { id: "20000000-0000-4000-8000-000000000001", title: "En la farmacia", cefr: "A2", sourceType: "topic", route: "/explore/scenarios/personal.20000000-0000-4000-8000-000000000001", createdAt: "2026-09-11T00:00:00.000Z" } }) });
  });

  await page.goto("/explore");
  await page.getByRole("button", { name: /随机来一个/ }).click();
  const generatorTrigger = page.getByRole("button", { name: "生成私人场景" });
  await generatorTrigger.click();
  await page.getByRole("button", { name: "关闭私人场景生成" }).click();
  await expect(generatorTrigger).toBeFocused();
  await generatorTrigger.click();
  await expect(page.getByRole("radio", { name: /按主题/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /用收藏表达/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /从阅读迁移/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /练近期难点/ })).toBeVisible();
  await page.getByLabel("练习主题").fill("在药店询问用法");
  await page.getByRole("button", { name: "确认生成私人场景" }).click();
  await expect(page.getByText("私人场景已经保存，可以立即开始。")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看并开始" })).toHaveAttribute("href", "/explore/scenarios/personal.20000000-0000-4000-8000-000000000001");
  expect(generationRequest).toMatchObject({ header: expect.stringMatching(/^generate-/u), body: { source: { sourceType: "topic", topic: "在药店询问用法" } } });
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});

test("keeps communication themes inside the scenario filter instead of a long index", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");
  await expect(page.getByText("询问近况")).toHaveCount(0);
  await page.getByRole("button", { name: "筛选场景" }).click();
  await expect(page.getByRole("dialog", { name: "场景筛选" }).getByText("沟通主题")).toBeVisible();
});

test("opens and closes the published content detail", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/explore");
  await page.getByRole("tab", { name: "内容包" }).click();

  const packButton = page.getByRole("button", { name: /查看.*可开始/ });
  await packButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("explore-detail-rail")).toContainText("可开始");
  await expect(page.getByRole("link", { name: "开始这组内容" })).toHaveAttribute("href", "/explore/packs/immersive.first-cafe-conversation");
  await page.getByRole("button", { name: "关闭内容详情" }).click();
  await expect(page.getByTestId("explore-detail-rail")).toHaveCount(0);
  await expect(packButton).toBeFocused();
});

test("follows the published action to the content workspace", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");
  await page.getByRole("tab", { name: "内容包" }).click();
  await page.getByRole("button", { name: /查看.*可开始/ }).click();
  await page.getByRole("link", { name: "开始这组内容" }).click();
  await expect(page).toHaveURL(/\/explore\/packs\/immersive\.first-cafe-conversation$/);
  await expect(page.getByRole("heading", { name: "咖啡馆里的新朋友" })).toBeVisible();
});

test("restores the detail rail from a deep link and keeps the query visible", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/explore?pack=immersive.first-cafe-conversation&q=咖啡馆");

  await expect(page.getByRole("searchbox")).toHaveValue("咖啡馆");
  await expect(page.getByTestId("explore-detail-rail")).toContainText("咖啡馆里的新朋友");
  await page.getByRole("button", { name: "关闭内容详情" }).click();
  await expect(page).toHaveURL(/\/explore\?q=%E5%92%96%E5%95%A1%E9%A6%86/);
});

test("keeps search and layout usable across desktop and mobile widths", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/explore");
    await expect(page.getByRole("searchbox")).toBeVisible();
    await page.getByRole("tab", { name: "内容包" }).click();
    await page.getByRole("button", { name: "筛选内容包" }).click();
    const savedFilter = page.getByRole("button", { name: "已保存内容包" });
    await savedFilter.click();
    await expect(page).toHaveURL(/(?:\?|&)saved=1(?:&|$)/u);
    await page.getByRole("button", { name: "筛选内容包" }).click();
    await page.getByRole("button", { name: "全部内容包" }).click();
    await page.getByRole("searchbox").fill("不存在的表达");
    await expect(page.getByText("暂时没有匹配的内容包")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `explore page overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
