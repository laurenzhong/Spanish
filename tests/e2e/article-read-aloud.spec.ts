import { expect, test, type Page } from "@playwright/test";
import { installReadAloud } from "./fixtures/read-aloud";

async function openReader(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL }]);
  await page.route("**/api/v1/read/word-explanation", (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto("/read/article/article.sueno-first-cafe@1");
}

test("sends the selected word to the shared endpoint and waits for actual playback", async ({ page, baseURL }) => {
  await installReadAloud(page, { autoStart: false });
  await openReader(page, baseURL!);
  const token = page.locator(".reader-token").first();
  const word = await token.textContent();
  await token.click();
  const button = page.locator(".article-reader__selected-word button");
  await button.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: word, lang: "es-ES" }]);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(1);
  await expect(page.locator(".article-reader__tools [role=status]")).toContainText("正在准备语音");
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(new Event("playing")));
  await expect(page.locator(".article-reader__tools [role=status]")).toContainText("正在朗读");
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(new Event("ended")));
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".article-reader__tools [role=status]")).toHaveCount(0);
});

test("stops word playback and ignores callbacks from the stopped attempt", async ({ page, baseURL }) => {
  await installReadAloud(page);
  await openReader(page, baseURL!);
  await page.locator(".reader-token").first().click();
  const button = page.locator(".article-reader__selected-word button");
  await button.click();
  await expect(page.locator(".article-reader__tools [role=status]")).toContainText("正在朗读");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);
  await button.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(2);
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(new Event("ended")));
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
});

test("replays a completed word without another request on a slow connection and clears it on logout", async ({ page, baseURL }, testInfo) => {
  await installReadAloud(page);
  let requests = 0;
  await page.route("**/api/v1/tts", async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await openReader(page, baseURL!);
  await page.locator(".reader-token").first().click();
  const button = page.locator(".article-reader__selected-word button");
  // Measure inside the browser, excluding Playwright selector/polling overhead.
  await page.evaluate(() => {
    const timings = { clicks: [] as number[], starts: [] as number[] };
    Reflect.set(window, "readAloudTimings", timings);
    document.querySelector(".article-reader__selected-word button")!.addEventListener("click", () => timings.clicks.push(performance.now()));
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.startsWith("blob:")) timings.starts.push(performance.now());
      return original.call(this);
    };
  });
  await button.click();
  await expect(page.locator(".article-reader__tools [role=status]")).toContainText("正在朗读");
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[0].dispatchEvent(new Event("ended")));
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(2);
  expect(requests).toBe(1);
  const timings = await page.evaluate(() => {
    const values = Reflect.get(window, "readAloudTimings") as { clicks: number[]; starts: number[] };
    return { simulatedNetworkMs: 800, firstMs: values.starts[0] - values.clicks[0], replayMs: values.starts[1] - values.clicks[1] };
  });
  console.log(`Read-aloud simulated network timings (${testInfo.project.name}): ${JSON.stringify(timings)}`);
  await testInfo.attach("simulated-network-timings", { body: JSON.stringify(timings), contentType: "application/json" });
  await page.evaluate(() => Reflect.get(window, "readAloudAudios")[1].dispatchEvent(new Event("ended")));
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.dispatchEvent(new Event("account-signed-out")));
  await button.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(3);
  expect(requests).toBe(2);
  await button.click();
});

test("shows a recoverable provider error and retries through the same endpoint", async ({ page, baseURL }) => {
  await installReadAloud(page);
  let attempts = 0;
  await page.route("**/api/v1/tts", async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE" } } });
    else await route.fallback();
  });
  await openReader(page, baseURL!);
  await page.locator(".reader-token").first().click();
  const button = page.locator(".article-reader__selected-word button");
  await button.click();
  await expect(page.locator(".article-reader__tools [role=status]")).toContainText("暂时无法朗读");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(page.locator(".article-reader__tools [role=status]")).toContainText("正在朗读");
  expect(attempts).toBe(2);
  await button.click();
});

test("reads the full article sequentially without truncating or prefetching paid chunks", async ({ page, baseURL }) => {
  await installReadAloud(page);
  await openReader(page, baseURL!);
  const paragraphs = await page.locator("[data-reader-position]").evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  const expected = paragraphs.join(" ");
  expect(expected.length).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "朗读", exact: true }).click();
  await page.getByRole("button", { name: "朗读全文", exact: true }).click();
  let completed = "";
  for (let index = 0; completed.length < expected.length; index++) {
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(index + 1);
    const requests = await page.evaluate(() => Reflect.get(window, "readAloudTrace")) as { text: string; lang: string }[];
    expect(requests).toHaveLength(index + 1);
    expect(requests[index].text.length).toBeLessThanOrEqual(1000);
    if (index === 0) expect(requests[index].text.length).toBeLessThanOrEqual(180);
    expect(requests[index].lang).toBe("es-ES");
    completed += requests[index].text;
    expect(expected.startsWith(completed)).toBe(true);
    await page.evaluate((position) => Reflect.get(window, "readAloudAudios")[position].dispatchEvent(new Event("ended")), index);
  }
  expect(completed).toBe(expected);
  await expect(page.getByRole("button", { name: "朗读全文", exact: true })).toBeEnabled();
});
