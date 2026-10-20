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
  // The filter and sort controls share the header line with the channel tabs
  // and the search field; they must not take a band of their own above the
  // grid, which is what pushed the first card row down.
  const filterTrigger = page.getByRole("button", { name: "筛选" });
  await expect(filterTrigger).toBeVisible();
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveValue("recently_added");
  const headerBox = await page.locator(".media-library__topbar").boundingBox();
  const triggerBox = await filterTrigger.boundingBox();
  const searchBox = await page.getByRole("searchbox", { name: "搜索视频和播客" }).boundingBox();
  if (!headerBox || !triggerBox || !searchBox) throw new Error("media library header layout probe failed");
  expect(triggerBox.y).toBeGreaterThanOrEqual(headerBox.y);
  expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
  // Same line as the search field, to its left.
  expect(triggerBox.y).toBeLessThan(searchBox.y + searchBox.height);
  expect(searchBox.y).toBeLessThan(triggerBox.y + triggerBox.height);
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(searchBox.x);
  await expect(page.getByText(/开始第一次练习|继续学习|当前沟通目标/)).toHaveCount(0);
  await expect(page.getByTestId("learn-timeline")).toHaveCount(0);
});

test("keeps topics and filters in the URL and offers a clear empty-result recovery", async ({ page }) => {
  await page.route("**/api/v1/media?*", (route) => route.fulfill({ json: {
    apiVersion: "v1", data: { items: [] }, page: { nextCursor: null, hasMore: false },
  } }));
  await authenticate(page);
  await page.goto("/learn?kind=podcast&topic=current-events&cefr=B1&duration=short&region=es-ES");

  await expect(page.getByRole("navigation", { name: "学习频道" }).getByRole("link", { name: "播客", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "学习主题" })).toHaveCount(0);
  // The applied state is carried by the trigger's name and badge; clearing it
  // lives with the fields it resets, inside the panel.
  const filterTrigger = page.getByRole("button", { name: "筛选，已应用 3 个条件" });
  await expect(filterTrigger).toBeVisible();
  await expect(page.getByRole("combobox", { name: "排序" })).toBeVisible();
  // This server deliberately has no database. An outage must first remain an
  // outage; only a successful zero-result read may render the filter empty state.
  await expect(page.getByRole("heading", { name: "换个筛选条件看看" })).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: "换个筛选条件看看" })).toBeVisible();
  await expect(page.getByRole("link", { name: "清除筛选" })).toHaveCount(0);
  await filterTrigger.click();
  await expect(page.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/learn?kind=podcast");
  await expect(page.getByRole("combobox", { name: "难度" })).toHaveValue("B1");
  await expect(page.getByRole("combobox", { name: "地区" })).toHaveValue("es-ES");
});

test("keeps the media library usable across the release viewport matrix", async ({ page }) => {
  await authenticate(page);

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/learn");

    await expect(page.locator(".media-library")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "搜索视频和播客" })).toBeVisible();
    await expect(page.getByRole("button", { name: "筛选" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "排序" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll, `media library overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
