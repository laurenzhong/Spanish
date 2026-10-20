import { expect, test } from "@playwright/test";
import { installSeriesMedia } from "./fixtures/media-series";

test.setTimeout(60_000);
test.beforeEach(async ({ page, baseURL }) => { await installSeriesMedia(page, baseURL!); });

test("native ended shows six videos below the player without autoplay, then manual navigation restores progress", async ({ page }, testInfo) => {
  let recommendationReads = 0;
  const evidenceWrites: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/series-recommendations")) recommendationReads += 1;
    if (request.method() !== "GET" && /evidence|skill-state/.test(request.url())) evidenceWrites.push(request.url());
  });
  // A failed completion save must not prevent a read-only recommendation.
  await page.route("**/api/v1/media/video.e2e-native/progress", (route) => route.fulfill({ status: 503, json: { error: { code: "MEDIA_UNAVAILABLE" } } }));
  await page.goto("/learn/media/video.e2e-native");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const video = page.locator(".media-detail__player video");
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 3.999;
    element.dispatchEvent(new Event("timeupdate"));
    element.dispatchEvent(new Event("pause"));
  });
  expect(recommendationReads).toBe(0);
  await expect(page.locator(".media-series-recommendations")).toHaveCount(0);
  await page.getByRole("button", { name: "双语", exact: true }).evaluate((element: HTMLButtonElement) => element.focus({ preventScroll: true }));
  const before = await page.evaluate(() => ({ y: window.scrollY, active: document.activeElement?.textContent, plays: document.querySelector("video")?.dataset.playCalls ?? "0" }));
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 4;
    element.dispatchEvent(new Event("ended"));
  });
  const section = page.getByRole("region", { name: "当前系列的其他视频" });
  await expect(section.locator(".media-card")).toHaveCount(6);
  await expect(page.getByText("本次进度未能同步，暂停或继续播放时会重试。")).toBeVisible();
  await expect(section.locator(".media-card__link").first()).toHaveAttribute("href", "/learn/media/youtube.e2e-cafe");
  expect(await section.locator('.media-card__link[href="/learn/media/video.e2e-native"]').count()).toBe(0);
  expect(await page.evaluate(() => ({ y: window.scrollY, active: document.activeElement?.textContent, plays: document.querySelector("video")?.dataset.playCalls ?? "0" }))).toEqual(before);
  const geometry = await page.evaluate(() => ({ player: document.querySelector(".media-detail__player")!.getBoundingClientRect().bottom, cards: document.querySelector(".media-series-recommendations")!.getBoundingClientRect().top }));
  expect(geometry.cards).toBeGreaterThanOrEqual(geometry.player);
  expect(await section.evaluate((element) => element.closest(".media-learning-workbench__transcript"))).toBeNull();
  await video.evaluate((element) => element.dispatchEvent(new Event("ended")));
  expect(recommendationReads).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/media-series/${testInfo.project.name}-after-playback.png`, fullPage: true });
  await section.locator('.media-card__link[href="/learn/media/video.e2e-series-01"]').click();
  await expect(page).toHaveURL(/\/learn\/media\/video.e2e-series-01/);
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("data-current-time", "1");
  await expect(page.locator(".media-series-recommendations")).toHaveCount(0);
  expect(evidenceWrites).toEqual([]);
});

test("replay hides recommendations and the next ending fetches a fresh list", async ({ page }) => {
  let reads = 0;
  page.on("request", (request) => { if (request.url().endsWith("/series-recommendations")) reads += 1; });
  await page.goto("/learn/media/video.e2e-native");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const video = page.locator("video");
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 4; element.dispatchEvent(new Event("ended")); });
  await expect(page.locator(".media-series-recommendations .media-card")).toHaveCount(6);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1; element.dispatchEvent(new Event("seeked")); });
  await expect(page.locator(".media-series-recommendations")).toHaveCount(0);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 4; element.dispatchEvent(new Event("ended")); });
  await expect(page.locator(".media-series-recommendations .media-card")).toHaveCount(6);
  expect(reads).toBe(2);
});

test("retries recommendation failures locally and hides empty results; podcasts keep selection only", async ({ page }) => {
  let mode: "error" | "empty" = "error";
  let reads = 0;
  await page.route("**/series-recommendations", (route) => {
    reads += 1;
    return mode === "error"
      ? route.fulfill({ status: 503, json: { error: { code: "MEDIA_SERIES_UNAVAILABLE" } } })
      : route.fulfill({ json: { apiVersion: "v1", data: { series: null, items: [] } } });
  });
  await page.goto("/learn/media/video.e2e-native");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await page.locator("video").evaluate((element) => element.dispatchEvent(new Event("ended")));
  const notice = page.locator(".media-series-recommendations__notice[role='alert']");
  await expect(notice).toContainText("暂时无法读取同系列视频");
  mode = "empty";
  await notice.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".media-series-recommendations__notice")).toHaveCount(0);
  await expect(page.locator(".media-series-recommendations")).toHaveCount(0);
  expect(reads).toBe(2);
  await page.goto("/learn/media/podcast.e2e-cafe");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await page.locator("audio").evaluate((element) => element.dispatchEvent(new Event("ended")));
  await expect(page.getByRole("button", { name: "选集", exact: true })).toBeVisible();
  await expect(page.locator(".media-series-recommendations")).toHaveCount(0);
  expect(reads).toBe(2);
});
