import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { corpusFixtures, installCorpusExamples, installCorpusSpeech } from "./fixtures/corpus-examples";

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
  await installCorpusExamples(page);
});

test("searches full examples, restores history and compares source contexts without writes", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/read/corpus");
  await expect(page.locator(".corpus-example")).toHaveCount(3);
  await page.locator(".corpus-example").first().getByText("展开前后文").click();
  await expect(page.getByText(corpusFixtures[0].before!, { exact: true })).toBeVisible();
  await expect(page.locator(".corpus-example").first().getByRole("link", { name: /读原文：/ })).toHaveAttribute("href", "/read/article/article.sueno-first-cafe%401#segment-1");
  await expect(page.locator(".corpus-example").nth(1).getByRole("link", { name: /到原处听：/ })).toHaveAttribute("href", "/learn/media/youtube.e2e-cafe?t=3000&segment=1#segment-1");
  await page.getByRole("button", { name: "加入对照", exact: true }).first().click();
  await page.getByRole("button", { name: "加入对照", exact: true }).first().click();
  const comparison = page.getByRole("region", { name: "用例对照" });
  await expect(comparison.locator("article")).toHaveCount(2);
  await page.getByRole("button", { name: "隐藏译文" }).click();
  await expect(page.locator(".corpus-translation")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "搜索西语单词或短语" }).fill("cafe");
  await page.getByRole("button", { name: "查用法" }).click();
  await expect(page.locator(".corpus-example__text mark")).toHaveText(["café", "café"]);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("第 2 / 2 页")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("第 1 / 2 页")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("cafe");
  await page.getByRole("group", { name: "用例内容类型" }).getByRole("button", { name: "视频", exact: true }).click();
  await expect(page.locator(".corpus-example")).toHaveCount(1);
  await page.getByRole("button", { name: "同段包含全部词" }).click();
  await expect(page).toHaveURL(/match=all/);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("cafe");
  await expect(page.locator(".corpus-example")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "用例对照" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("keeps complete matching sentences readable in long article paragraphs", async ({ page }) => {
  await installCorpusSpeech(page);
  const sentence = "Por eso, María toma café antes de salir.";
  const original = "La vida cotidiana de la ciudad cambia con las estaciones y con las costumbres de sus habitantes. ".repeat(6) + sentence;
  await page.route("**/api/v1/corpus/examples*", (route) => route.fulfill({ status: 200, json: { data: { items: [{ ...corpusFixtures[0], text: original }], page: 1, pageSize: 12, total: 1 } } }));
  await page.goto("/read/corpus?q=por+eso");
  const example = page.locator(".corpus-example");
  await expect(example.locator(".corpus-example__text")).toHaveText(sentence);
  await expect(example.locator("mark")).toHaveText("Por eso");
  await example.getByRole("button", { name: `朗读：${sentence}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: sentence, lang: "es-ES" }]);
  await example.getByRole("button", { name: "加入对照", exact: true }).click();
  await expect(page.getByRole("region", { name: "用例对照" }).getByText(sentence, { exact: true })).toBeVisible();
  await example.getByText("展开前后文", { exact: true }).click();
  await expect(example.locator(".corpus-context-detail__current")).toHaveText(original);
});

test("speaks Spanish, ignores stale audio callbacks and cancels when querying", async ({ page }) => {
  await installCorpusSpeech(page);
  await page.goto("/read/corpus");
  await page.getByRole("button", { name: `朗读：${corpusFixtures[0].text}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: corpusFixtures[0].text, lang: "es-ES" }]);
  await page.getByRole("button", { name: `朗读：${corpusFixtures[1].text}`, exact: true }).click();
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(new Event("ended")));
  await expect(page.getByRole("button", { name: `停止：${corpusFixtures[1].text}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  const cancels = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: "按原词序", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(cancels);
  await page.getByRole("button", { name: `朗读：${corpusFixtures[1].text}`, exact: true }).click();
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[2].dispatchEvent(Object.assign(new Event("error"), { error: "synthesis-failed" })));
  await expect(page.locator(".corpus-feedback [role=alert]")).toBeVisible();
  await page.getByRole("button", { name: `朗读：${corpusFixtures[1].text}`, exact: true }).click();
  await expect(page.locator(".corpus-feedback [role=alert]")).toHaveCount(0);
});

test("distinguishes empty results and failed reads, retains examples and recovers", async ({ page }) => {
  await page.goto("/read/corpus");
  await expect(page.locator(".corpus-example")).toHaveCount(3);
  await page.route("**/api/v1/corpus/examples*", (route) => route.fulfill({ status: 503, json: {} }));
  await page.getByRole("button", { name: "查用法" }).click();
  await expect(page.locator(".corpus-feedback").getByRole("alert")).toContainText("上一组结果仍保留");
  await expect(page.locator(".corpus-example")).toHaveCount(3);
  await page.unroute("**/api/v1/corpus/examples*");
  await installCorpusExamples(page);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".corpus-feedback").getByRole("alert")).toHaveCount(0);
  await page.getByRole("searchbox").fill("missing");
  await page.getByRole("button", { name: "查用法" }).click();
  await expect(page.getByRole("heading", { name: "暂时没有这个说法的用例" })).toBeVisible();
  await page.getByRole("button", { name: "浏览全部用例" }).click();
  await expect(page.locator(".corpus-example")).toHaveCount(3);
});

test("keeps reading available without speech and opens a versioned article in a new tab", async ({ page }) => {
  await installCorpusSpeech(page);
  await page.route("**/api/v1/tts", (route) => route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE" } } }));
  await page.goto("/read/corpus");
  await page.getByRole("button", { name: `朗读：${corpusFixtures[0].text}`, exact: true }).click();
  await expect(page.locator(".corpus-feedback").getByRole("alert")).toContainText("暂时无法朗读");
  const popupPromise = page.waitForEvent("popup");
  await page.locator(".corpus-example").first().getByRole("link", { name: /读原文：/ }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/article.sueno-first-cafe(?:%40|@)1#segment-1/u);
  await expect(popup.locator("#segment-1")).toBeVisible();
  await popup.close();
  await expect(page.locator(".corpus-example")).toHaveCount(3);
});

test("keeps complete examples and comparison usable across sizes and themes", async ({ page }, testInfo) => {
  await page.goto("/read/corpus");
  await page.getByRole("button", { name: "加入对照", exact: true }).first().click();
  await page.getByRole("button", { name: "加入对照", exact: true }).first().click();
  await page.locator(".corpus-example").first().getByText("展开前后文").click();
  await mkdir("test-results/corpus-redesign", { recursive: true });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      await expect.poll(() => page.locator(".corpus-example__text").first().evaluate((element) => {
        const probe = document.createElement("span"); probe.style.color = "var(--foreground)"; document.body.appendChild(probe);
        const expected = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(element).color === expected;
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${theme} ${width}px`).toBe(true);
      expect(await page.locator(".corpus-tool, .corpus-source-link").evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().height >= 44))).toBe(true);
      if ([375, 1440].includes(width)) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `test-results/corpus-redesign/${testInfo.project.name}-${width}-${theme}.png`, fullPage: true, animations: "disabled" }); }
    }
  }
});
