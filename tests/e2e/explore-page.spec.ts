import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

test("keeps the desktop discovery workspace focused while exposing three content views", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/explore");

  await expect(page.getByRole("heading", { name: "探索场景" })).toHaveClass(/sr-only/u);
  await expect(page.getByRole("link", { name: "练习历史" })).toHaveAttribute("href", "/explore/history");
  await expect(page.getByRole("tablist", { name: "探索内容" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "场景" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("searchbox", { name: "搜索场景" })).toHaveAttribute("placeholder", "搜索场景");
  await expect(page.locator(".explore-scenario-grid > a")).toHaveCount(9);
  await expect(page.getByRole("link", { name: "校园办事：注册与材料" })).toBeVisible();
  await expect(page.getByRole("link", { name: "交通沟通：买票与改签" })).toBeVisible();
  await expect(page.getByRole("button", { name: /收藏表达/u })).toHaveCount(0);
  await page.getByRole("tab", { name: "表达" }).click();
  await expect(page.getByRole("button", { name: "筛选表达" })).toBeVisible();
  await expect(page.getByRole("button", { name: /收藏表达|已收藏/u }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /校园办事/u })).toHaveCount(0);
  await page.getByRole("tab", { name: "内容包" }).click();
  await expect(page.getByRole("button", { name: "筛选内容包" })).toBeVisible();
  await expect(page.locator(".explore-pack-card").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
});

test("finds scenarios through their expressions and cleans legacy URL state", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore?view=scenarios&q=que%20documentos&pack=immersive.first-cafe-conversation&saved=1&filter=reading");

  await expect(page.getByRole("searchbox", { name: "搜索场景" })).toHaveValue("que documentos");
  await expect(page.getByRole("link", { name: /校园办事：注册与材料/u })).toBeVisible();
  await expect(page.getByText("¿Qué documentos tengo que presentar?", { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/(?:\?|&)(?:pack|saved|filter)=/u);

  await page.getByRole("button", { name: "筛选场景" }).click();
  await page.getByRole("button", { name: "可立即开始" }).click();
  await expect(page).toHaveURL(/(?:\?|&)filter=available(?:&|$)/u);
  await page.reload();
  await expect(page.getByText("可立即开始 ×")).toBeVisible();

  await page.getByRole("searchbox", { name: "搜索场景" }).fill("完全不存在的场景");
  await expect(page.getByText("没有匹配的场景")).toBeVisible();
  await page.getByRole("button", { name: "清除搜索和筛选" }).click();
  await expect(page.getByRole("searchbox", { name: "搜索场景" })).toHaveValue("");
  await expect(page.getByRole("link", { name: "校园办事：注册与材料" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: /适合我的/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /探索新场景/u })).toBeVisible();
  await page.getByRole("button", { name: /随机来一个/u }).click();
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
  await page.route("**/api/v1/scenarios", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { scenarios: [], generationSources: { savedExpressions: [{ id: "10000000-0000-4000-8000-000000000001", label: "Quisiera pedir ayuda.", detail: "我想请求帮助。" }], readingHighlights: [], recentErrors: [] }, generationAvailable: true } }) }));
  await page.route("**/api/v1/scenarios/generate", async (route) => {
    generationRequest = { header: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() as { source?: { sourceType?: string; topic?: string } } };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { id: "20000000-0000-4000-8000-000000000001", title: "En la farmacia", cefr: "A2", sourceType: "topic", route: "/explore/scenarios/personal.20000000-0000-4000-8000-000000000001", createdAt: "2026-09-11T00:00:00.000Z" } }) });
  });

  await page.goto("/explore");
  const generatorTrigger = page.getByRole("button", { name: "生成私人场景" });
  await expect(generatorTrigger).toBeVisible();
  await generatorTrigger.click();
  await expect(page.getByLabel("练习主题")).toBeFocused();
  expect(generationRequest).toBeNull();
  await page.getByRole("button", { name: "关闭私人场景生成" }).click();
  await expect(generatorTrigger).toBeFocused();
  await generatorTrigger.click();
  await expect(page.getByRole("radio", { name: /按主题/u })).toBeChecked();
  await expect(page.getByRole("radio", { name: /用收藏表达/u })).toBeVisible();
  await expect(page.getByRole("radio", { name: /从阅读迁移/u })).toBeVisible();
  await expect(page.getByRole("radio", { name: /练近期难点/u })).toBeVisible();
  await page.getByLabel("练习主题").fill("在药店询问用法");
  await page.getByRole("button", { name: "确认生成私人场景" }).click();
  await expect(page.getByText("私人场景已经保存，可以立即开始。")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看并开始" })).toHaveAttribute("href", "/explore/scenarios/personal.20000000-0000-4000-8000-000000000001");
  expect(generationRequest).toMatchObject({ header: expect.stringMatching(/^generate-/u), body: { source: { sourceType: "topic", topic: "在药店询问用法" } } });
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});

test("keeps the generation action near the selection with a long saved expressions list", async ({ page }) => {
  await authenticate(page);
  const sources = Array.from({ length: 20 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    label: `¿Podría ayudarme con el trámite número ${index + 1}?`,
    detail: "我想确认办理手续需要带哪些材料。",
  }));
  await page.route("**/api/v1/scenarios", (route) => route.fulfill({
    json: { data: { generationAvailable: true, generationSources: { savedExpressions: sources, readingHighlights: [], recentErrors: [] } } },
  }));
  for (const width of [320, 375, 1024]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 720 });
    await page.goto("/explore");
    await page.getByRole("button", { name: "生成私人场景", exact: true }).click();
    await page.getByText("用收藏表达", { exact: true }).click();
    const fieldset = page.getByRole("group", { name: "选择一项" });
    await expect(fieldset.getByRole("radio")).toHaveCount(20);
    await fieldset.getByText(sources[0]!.label, { exact: true }).click();
    const confirm = page.getByRole("button", { name: "确认生成私人场景" });
    await expect(confirm).toBeEnabled();
    const actionBounds = await confirm.evaluate((element) => {
      const action = element.getBoundingClientRect();
      const navigation = document.querySelector(".primary-navigation")?.getBoundingClientRect();
      const visibleBottom = navigation && navigation.height > 0 && navigation.bottom >= innerHeight - 1
        ? navigation.top : innerHeight;
      return { top: action.top, bottom: action.bottom, visibleBottom };
    });
    expect(actionBounds.top).toBeGreaterThanOrEqual(0);
    expect(actionBounds.bottom).toBeLessThanOrEqual(actionBounds.visibleBottom);
    const lastOption = fieldset.getByText(sources[19]!.label, { exact: true });
    await lastOption.click();
    await expect(fieldset.getByRole("radio", { name: /número 20\?/u })).toBeChecked();
    expect(await fieldset.locator(".personal-scenario-generator__options").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
});

test("supports keyboard tabs and provides a return path from practice history", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");
  const tabs = page.getByRole("tablist", { name: "探索内容" });
  await tabs.getByRole("tab", { name: "场景" }).focus();
  await page.keyboard.press("ArrowRight");
  const expressions = tabs.getByRole("tab", { name: "表达", selected: true });
  await expect(expressions).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "表达" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^朗读表达：/u }).first()).toBeVisible();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "内容包", selected: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "场景", selected: true })).toBeFocused();
  await page.getByRole("link", { name: "练习历史" }).click();
  await expect(page.getByRole("heading", { name: "场景练习历史" })).toBeVisible();
  await expect(page.getByRole("link", { name: "到期复现" })).toBeVisible();
  await page.getByRole("link", { name: "返回探索" }).click();
  await expect(page.getByRole("searchbox", { name: "搜索场景" })).toBeVisible();
});

test("uses the shared Spanish read-aloud endpoint and recovers when it is unavailable", async ({ page }) => {
  await authenticate(page);
  const requests: unknown[] = [];
  await page.route("**/api/v1/tts", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE" } } });
  });
  await page.goto("/explore?view=expressions");
  const first = page.locator(".explore-expression-card").first();
  const text = await first.locator("[lang=es]").innerText();
  const readAloud = first.getByRole("button", { name: /^朗读表达：/u });
  await readAloud.click();
  await expect(page.getByRole("status").filter({ hasText: "朗读" })).toBeVisible();
  await expect(readAloud).toBeEnabled();
  expect(requests).toEqual([{ text, languageTag: "es-ES" }]);
  await expect(first.getByRole("heading")).toHaveText(text);
  const scenario = first.getByRole("link", { name: "进入关联场景" });
  await expect(scenario).toHaveAttribute("href", "/explore/scenarios/scenario.restaurant-ordering");
  await scenario.click();
  await expect(page).toHaveURL(/\/explore\/scenarios\/scenario\.restaurant-ordering$/u);
  await expect(page.getByRole("heading", { name: "餐厅沟通：点单与饮食限制" })).toBeVisible();
});

test("keeps communication themes inside the scenario filter instead of a long index", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");
  await expect(page.getByText("询问近况")).toHaveCount(0);
  await page.getByRole("button", { name: "筛选场景" }).click();
  await expect(page.getByRole("dialog", { name: "场景筛选" }).getByText("沟通主题")).toBeVisible();
});

test("keeps scenario discovery usable across desktop and mobile widths", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/explore");
    await expect(page.getByRole("searchbox", { name: "搜索场景" })).toBeVisible();
    await page.getByRole("button", { name: "筛选场景" }).click();
    await page.getByRole("button", { name: "可立即开始" }).click();
    await expect(page).toHaveURL(/(?:\?|&)filter=available(?:&|$)/u);
    await page.getByRole("searchbox", { name: "搜索场景" }).fill("不存在的场景");
    await expect(page.getByText("没有匹配的场景")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `explore page overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
