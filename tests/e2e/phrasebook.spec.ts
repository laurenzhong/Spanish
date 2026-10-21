import { installReadAloud } from "./fixtures/read-aloud";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;
const evidenceDir = process.env.PHRASEBOOK_EVIDENCE_DIR ?? "test-results/phrasebook";

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL }]);
});

test("teaches full expressions, filters by purpose, and preserves account-scoped bookmarks without evidence", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/read/phrases");
  await expect(page.getByRole("heading", { name: "短语", exact: true })).toBeVisible();
  await expect(page.locator(".phrasebook-entry")).toHaveCount(120);
  await expect(page.getByText("Bastante bien. He empezado un trabajo nuevo.")).toBeVisible();
  await expect(page.getByText("打开来源", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /没听懂时/u }).click();
  await expect(page.locator(".phrasebook-entry")).toHaveCount(20);
  await page.getByRole("button", { name: "收藏 ¿Puedes repetirlo, por favor?" }).click();
  await page.getByRole("button", { name: /我的收藏/u }).click();
  await expect(page.locator(".phrasebook-entry")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: /我的收藏/u }).click();
  await expect(page.getByRole("button", { name: "取消收藏 ¿Puedes repetirlo, por favor?" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("searchbox", { name: "搜索短语" }).fill("不存在的短语");
  await expect(page.getByRole("heading", { name: "换个说法试试" })).toBeVisible();
  await page.getByRole("button", { name: "查看全部表达" }).click();
  await expect(page.locator(".phrasebook-entry")).toHaveCount(120);
  expect(writes).toEqual([]);
});

test("supports recall, reference answers, retrying a subset and keyboard exit without claiming mastery", async ({ page }) => {
  await page.goto("/read/phrases?search=最近过得怎么样");
  await expect(page.locator(".phrasebook-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "遮住西语" }).click();
  await expect(page.locator(".phrasebook-entry [lang=es]")).toHaveCount(0);
  await page.getByRole("button", { name: "揭晓表达" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué tal te va?" })).toBeVisible();
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  const practice = page.getByRole("region", { name: "情境自测" });
  await expect(practice.getByRole("heading", { name: "朋友正在学西语，问问他最近学得怎么样。" })).toBeFocused();
  await expect(practice.locator("[lang=es]")).toHaveCount(0);
  await practice.getByRole("button", { name: "查看参考表达" }).click();
  await expect(practice.getByText("¿Qué tal te va con el español?", { exact: true })).toBeVisible();
  await practice.getByRole("button", { name: "还想再练" }).click();
  await expect(practice.getByRole("heading", { name: "给表达一个真实的使用机会" })).toBeFocused();
  await practice.getByRole("button", { name: "再练刚才的表达" }).click();
  await expect(practice.locator("[lang=es]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "情境自测" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "情境自测", exact: true })).toBeFocused();
  await expect(page.getByRole("searchbox")).toHaveValue("最近过得怎么样");
});

test("fits phone, tablet and desktop in both themes with readable expanded content", async ({ page }, testInfo) => {
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("/read/phrases");
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      await expect(page.locator(".phrasebook-detail").first()).toBeVisible();
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(dimensions.scroll, `overflow at ${width} ${theme}`).toBeLessThanOrEqual(dimensions.client + 1);
      const smallTargets = await page.locator(".phrasebook-toolbar button, .phrasebook-entry__actions button, .phrasebook-sidebar button").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height < 44).length);
      expect(smallTargets).toBe(0);
      if ([375, 1440].includes(width)) await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-${width}-${theme}.png`, fullPage: false });
    }
  }
});

test("reads the displayed self-test answer in Spanish and cancels on stop, next and exit", async ({ page }, testInfo) => {
  await installReadAloud(page);
  await page.goto("/read/phrases?search=最近过得怎么样");
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  const practice = page.getByRole("region", { name: "情境自测" });
  await expect(practice.getByRole("button", { name: "朗读参考表达" })).toHaveCount(0);
  await practice.getByRole("button", { name: "查看参考表达" }).click();
  await practice.getByRole("button", { name: "朗读参考表达" }).click();
  await expect(practice.getByRole("button", { name: "停止朗读参考表达" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: "¿Qué tal te va con el español?", lang: "es-ES" }]);
  await practice.getByRole("button", { name: "停止朗读参考表达" }).click();
  await expect(practice.getByRole("button", { name: "朗读参考表达" })).toHaveAttribute("aria-pressed", "false");
  await practice.getByText("回看本条核心表达与用法").click();
  await practice.getByRole("button", { name: "朗读核心表达" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace").at(-1))).toEqual({ text: "¿Qué tal te va?", lang: "es-ES" });
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-self-test-audio.png`, fullPage: true });
  expect(await practice.locator(".phrasebook-speak").evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44))).toBe(true);
  const beforeCollapse = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await practice.getByText("回看本条核心表达与用法").click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeCollapse);
  await practice.getByRole("button", { name: "朗读参考表达" }).click();
  const beforeNext = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await practice.getByRole("button", { name: "还想再练" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeNext);
  await practice.getByRole("button", { name: "再练刚才的表达" }).click();
  await practice.getByRole("button", { name: "查看参考表达" }).click();
  await practice.getByRole("button", { name: "朗读参考表达" }).click();
  const beforeExit = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await practice.getByRole("button", { name: "退出自测" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeExit);
});

test("keeps self-test usable when the shared pronunciation service is unavailable", async ({ page }) => {
  await installReadAloud(page);
  await page.route("**/api/v1/tts", (route) => route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE" } } }));
  await page.goto("/read/phrases?search=最近过得怎么样");
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  await page.getByRole("button", { name: "查看参考表达" }).click();
  await page.getByRole("button", { name: "朗读参考表达" }).click();
  await expect(page.locator(".phrasebook-feedback")).toContainText("暂时无法朗读");
  await page.getByRole("button", { name: "想到说法了" }).click();
  await expect(page.getByRole("heading", { name: "给表达一个真实的使用机会" })).toBeVisible();
});
