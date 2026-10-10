import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

test("opens directly on video and podcast content discovery", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/learn");

  await expect(page.getByTestId("media-library")).toBeVisible();
  // The channel destinations are now scoped to their navigation: the public
  // library also contains media cards whose titles include 视频 or 播客, so a
  // page-wide role lookup is no longer unique.
  const channelNavigation = page.getByRole("navigation", { name: "学习频道" });
  await expect(channelNavigation.getByRole("link", { name: "全部", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(channelNavigation.getByRole("link", { name: "视频", exact: true })).toBeVisible();
  await expect(channelNavigation.getByRole("link", { name: "播客", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "学习主题" })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "搜索视频和播客" })).toBeVisible();
  await expect(page.getByRole("button", { name: "筛选" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveCount(0);
  await expect(page.getByText(/开始第一次练习|继续学习|当前沟通目标/)).toHaveCount(0);
  await expect(page.getByTestId("learn-timeline")).toHaveCount(0);
});

test("keeps topics and filters in the URL and offers a clear empty-result recovery", async ({ page }) => {
  await authenticate(page);
  await page.goto("/learn?kind=podcast&topic=current-events&cefr=B1&duration=short&region=es-ES");

  await expect(page.getByRole("navigation", { name: "学习频道" }).getByRole("link", { name: "播客", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "学习主题" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "筛选" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "换个筛选条件看看" })).toBeVisible();
  await expect(page.getByRole("link", { name: "清除筛选" })).toHaveCount(0);
});

test("keeps the media library usable across the release viewport matrix", async ({ page }) => {
  await authenticate(page);

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/learn");

    await expect(page.locator(".media-library")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "搜索视频和播客" })).toBeVisible();
    await expect(page.getByRole("button", { name: "筛选" })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll, `media library overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
