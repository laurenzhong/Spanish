import { expect, test } from "@playwright/test";
import { installSeriesMedia } from "./fixtures/media-series";

test.setTimeout(60_000);

test.beforeEach(async ({ page, baseURL }) => { await installSeriesMedia(page, baseURL!); });

test("keeps single-episode cards as direct entries and links to a bounded series directory", async ({ page }) => {
  const response = await page.request.get("/api/v1/media-series/series.e2e-video/episodes?pageSize=20");
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  await page.route("**/api/v1/media?*", (route) => route.fulfill({ json: { apiVersion: "v1", data: { items: data.items.slice(0, 2) }, page: { hasMore: false, nextCursor: null } } }));
  await page.goto("/learn");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".media-card")).toHaveCount(2);
  await expect(page.locator(".media-card__link").first()).toHaveAttribute("href", "/learn/media/video.e2e-series-01");
  expect(await page.locator("a a").count()).toBe(0);
  await page.locator(".media-card__series a").first().click();
  await expect(page).toHaveURL(/\/learn\/series\/series.e2e-video/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Conversaciones cotidianas");
  await expect(page.getByText("本站已收录 25 集")).toBeVisible();
  await expect(page.locator(".media-card")).toHaveCount(20);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".media-card")).toHaveCount(5);
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator(".media-card")).toHaveCount(20);
});

test("anchors a late current episode, navigates neighbors and restores picker focus", async ({ page, isMobile }) => {
  await page.goto("/learn/media/video.e2e-native");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const trigger = page.getByRole("button", { name: "选集", exact: true });
  await trigger.click();
  const picker = isMobile ? page.getByRole("dialog") : page.locator(".media-episode-picker__panel");
  await expect(picker.locator("[aria-current='true']")).toContainText("Una historia breve");
  await expect(picker.locator(".media-episode-picker__list > li")).toHaveCount(5);
  await expect(picker.getByRole("link", { name: "上一集", exact: true })).toHaveAttribute("href", "/learn/media/video.e2e-series-23");
  await expect(picker.getByRole("link", { name: "下一集", exact: true })).toHaveAttribute("href", "/learn/media/youtube.e2e-cafe");
  if (isMobile) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
  }
  await picker.getByRole("link", { name: "上一集", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/media\/video.e2e-series-23/);
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const box = await page.getByRole("button", { name: "选集", exact: true }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("supports podcast selection and local retry without blocking playback", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v1/media-series/series.e2e-podcast/episodes?*", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: { code: "MEDIA_SERIES_UNAVAILABLE" } } });
    else await route.continue();
  });
  await page.goto("/learn/media/podcast.e2e-cafe");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await page.getByRole("button", { name: "选集", exact: true }).click();
  await expect(page.locator(".media-series__notice[role='alert']")).toContainText("暂时无法读取");
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".media-episode-picker__list > li")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "下一集", exact: true })).toHaveAttribute("href", "/learn/media/podcast.e2e-series-03");
  await expect(page.locator(".media-detail__player audio")).toHaveCount(1);
});

test("fits the directory and picker at supported widths in both themes", async ({ page, isMobile }, testInfo) => {
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/learn/series/series.e2e-video");
    await expect(page.locator(".media-card")).toHaveCount(20);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      if (width === 375 || width === 1440) await page.screenshot({ path: `test-results/media-series/${testInfo.project.name}-${width}-${theme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: isMobile ? 375 : 1440, height: 900 });
  await page.goto("/learn/media/video.e2e-native");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await page.getByRole("button", { name: "选集", exact: true }).click();
  await expect(page.locator(".media-episode-picker__list > li")).toHaveCount(5);
  await page.screenshot({ path: `test-results/media-series/${testInfo.project.name}-picker.png`, fullPage: true });
});

test("shows honest empty and unavailable series states", async ({ page }) => {
  await page.goto("/learn/series/series.e2e-empty");
  await expect(page.getByText("本站已收录 0 集")).toBeVisible();
  await expect(page.getByText("暂无可播放的单集。")).toBeVisible();
  await page.goto("/learn/series/series.e2e-archived");
  await expect(page.locator(".media-series__notice[role='alert']")).toContainText("当前不可用");
  await expect(page.locator(".media-card")).toHaveCount(0);
});
