import { installReadAloud as fakeSpeech } from "./fixtures/read-aloud";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const evidenceDir = process.env.PHRASEBOOK_EVIDENCE_DIR ?? "test-results/phrasebook-v3";

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}` }]);
});

test("reads individual dialogue turns and cancels on switching, stop, collapse, topic and self-test", async ({ page }, testInfo) => {
  await fakeSpeech(page);
  const writes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/read/phrases?search=最近过得怎么样");
  await page.getByRole("button", { name: "朗读对话第1句" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: "¡Hola! ¿Qué tal te va?", lang: "es-ES" }]);
  const beforeSwitch = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: "朗读对话第2句" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeSwitch);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace").at(-1))).toEqual({ text: "Bastante bien. He empezado un trabajo nuevo.", lang: "es-ES" });
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(new Event("ended")));
  await expect(page.getByRole("button", { name: "停止朗读对话第2句" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "朗读对话第1句" })).toHaveAttribute("aria-pressed", "false");
  await mkdir(evidenceDir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-dialogue-audio.png`, fullPage: true });
  const beforeStop = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: "停止朗读对话第2句" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeStop);
  await page.getByRole("button", { name: "朗读对话第1句" }).click();
  const beforeCollapse = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeCollapse);
  await expect(page.getByRole("button", { name: "朗读对话第1句" })).toHaveCount(0);
  await page.getByRole("button", { name: "怎么用", exact: true }).click();
  await page.getByRole("button", { name: "朗读对话第2句" }).click();
  const beforeTopic = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: /没听懂时/u }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeTopic);
  await page.getByRole("navigation", { name: "短语交际主题" }).getByRole("button", { name: /全部表达/u }).click();
  await page.getByRole("button", { name: "朗读对话第1句" }).click();
  const beforePractice = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforePractice);
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.every((url) => url.endsWith("/api/v1/tts"))).toBe(true);
});

test("shows dialogue audio failures and allows retry", async ({ page }) => {
  await fakeSpeech(page);
  await page.goto("/read/phrases?search=最近过得怎么样");
  await page.getByRole("button", { name: "朗读对话第1句" }).click();
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(Object.assign(new Event("error"), { error: "synthesis-failed" })));
  await expect(page.locator(".phrasebook-feedback")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: "朗读对话第1句" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "朗读对话第1句" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace").length)).toBe(2);
  await expect(page.locator(".phrasebook-feedback")).toBeEmpty();
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[1].dispatchEvent(new Event("ended")));
  await expect(page.getByRole("button", { name: "朗读对话第1句" })).toHaveAttribute("aria-pressed", "false");
});

test("keeps dialogue readable when pronunciation is unavailable", async ({ page }) => {
  await fakeSpeech(page);
  await page.route("**/api/v1/tts", (route) => route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE" } } }));
  await page.goto("/read/phrases?search=最近过得怎么样");
  await page.getByRole("button", { name: "朗读对话第2句" }).click();
  await expect(page.locator(".phrasebook-feedback")).toContainText("暂时无法朗读");
  await expect(page.getByText("Bastante bien. He empezado un trabajo nuevo.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看参考表达" })).toBeVisible();
});

test("cancels dialogue audio when its last bookmark is removed", async ({ page }) => {
  await fakeSpeech(page);
  await page.goto("/read/phrases?search=最近过得怎么样");
  await page.getByRole("button", { name: "收藏 ¿Qué tal te va?" }).click();
  await page.getByRole("button", { name: /我的收藏/u }).click();
  await page.getByRole("button", { name: "朗读对话第2句" }).click();
  const beforeRemove = await page.evaluate(() => Reflect.get(window, "readAloudPauses"));
  await page.getByRole("button", { name: "取消收藏 ¿Qué tal te va?" }).click();
  await expect(page.getByRole("heading", { name: "换个说法试试" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(beforeRemove);
  await expect(page.getByRole("button", { name: "停止朗读对话第2句" })).toHaveCount(0);
});
