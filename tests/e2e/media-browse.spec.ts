import { expect, test } from "@playwright/test";
import { selectMediaBrowsePage } from "../../src/modules/media/domain/media-browse";
import type { MediaCard } from "../../src/modules/media/domain";

const cards: MediaCard[] = Array.from({ length: 80 }, (_, index) => ({
  id: `media.browse.${index}@1`, stableKey: `media.browse.${index}`, version: 1, kind: "podcast",
  title: `Browse episode ${index}`, summary: "A Spanish conversation.", sourceName: `Source ${index % 4}`,
  language: "es", region: "es-ES", cefr: "B1", topics: ["topic.daily-life"], durationMs: 120_000,
  publishedAt: null, curatedAt: "2026-10-13T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
  series: { seriesKey: `series.browse.${index % 12}`, title: `Programa ${index % 12}`, kind: "podcast", orderMode: "episodic", revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null },
}));
const sourceIdentities = new Map(cards.map((card, index) => [card.stableKey, `registered:source-${index % 4}`]));

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
  // Keep paging under explicit user control; prefetch remains enabled and is
  // checked through the same batch request, without loading the entire pool.
  await page.addInitScript(() => { window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver; });
  await page.route("**/api/v1/media/browse", async (route) => {
    const request = route.request().postDataJSON();
    const result = selectMediaBrowsePage(cards, request, sourceIdentities);
    await route.fulfill({ json: { apiVersion: "v1", data: { items: result.items }, page: { nextCursor: result.nextCursor, hasMore: result.hasMore } } });
  });
});

test("changes batches, retains filters, pages and returns to the same content", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/learn?kind=podcast&cefr=B1&region=es-ES&duration=short&topic=daily-life");
  await page.getByRole("button", { name: "换一批" }).click();
  await expect(page.locator(".media-card")).toHaveCount(24);
  const first = await page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const firstSeries = await page.locator(".media-card__series a").evaluateAll((links) => links.slice(0, 12).map((link) => link.getAttribute("href")));
  expect(new Set(firstSeries).size).toBe(12);
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveValue("browse");
  await expect(page).toHaveURL(/view=browse/);
  await page.getByRole("navigation", { name: "学习频道" }).getByRole("link", { name: "播客", exact: true }).click();
  await expect(page).toHaveURL(/view=browse/);
  expect(await page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(first);
  for (const part of ["kind=podcast", "cefr=B1", "region=es-ES", "duration=short", "topic=daily-life"]) expect(page.url()).toContain(part);

  await page.getByRole("button", { name: "换一批" }).click();
  await expect.poll(async () => page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).not.toEqual(first);
  const second = await page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(second.every((href) => !first.includes(href))).toBe(true);
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".media-card")).toHaveCount(48);
  const paged = await page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(paged).size).toBe(48);

  await page.evaluate(() => window.scrollTo(0, 550));
  await expect.poll(() => page.evaluate(() => window.history.state?.mediaBrowse?.scrollY ?? 0)).toBeGreaterThan(300);
  // Choose a visible card so clicking it doesn't itself scroll to a different row.
  const visibleIndex = await page.locator(".media-card__link").evaluateAll((links) => links.findIndex((link) => {
    const box = link.getBoundingClientRect(); return box.top > 0 && box.bottom < window.innerHeight;
  }));
  expect(visibleIndex).toBeGreaterThanOrEqual(0);
  await page.locator(".media-card__link").nth(visibleIndex).click();
  await expect(page).toHaveURL(/\/learn\/media\//);
  await page.goBack();
  await expect(page.locator(".media-card")).toHaveCount(48);
  await expect.poll(() => page.evaluate(() => window.history.state?.mediaBrowse?.scrollY ?? 0)).toBeGreaterThan(300);
  expect(await page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(paged);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveValue("browse");
  await page.getByRole("combobox", { name: "排序" }).selectOption("newest");
  await expect(page).toHaveURL(/sort=newest/);
  expect(page.url()).not.toContain("view=browse");
});

test("keeps cards on failure, retries and reports exhaustion", async ({ page }) => {
  await page.goto("/learn");
  await page.getByRole("button", { name: "换一批" }).click();
  await expect(page.locator(".media-card")).toHaveCount(24);
  const before = await page.locator(".media-card__link").first().getAttribute("href");
  await page.route("**/api/v1/media/browse", (route) => route.fulfill({ status: 503, json: { error: { code: "MEDIA_NOT_AVAILABLE" } } }));
  const failedResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/media/browse") && response.request().method() === "POST" && !response.request().postDataJSON().cursor);
  await page.getByRole("button", { name: "换一批" }).click();
  expect((await failedResponse).status()).toBe(503);
  await expect(page.getByRole("button", { name: "换一批" })).toBeEnabled();
  await expect(page.getByText("换一批失败，请重试。")).toHaveCount(0);
  await expect(page.getByText("正在换一批…")).toHaveCount(0);
  expect(await page.locator(".media-card__link").first().getAttribute("href")).toBe(before);
  await page.unroute("**/api/v1/media/browse");
  await page.route("**/api/v1/media/browse", (route) => route.fulfill({ json: { apiVersion: "v1", data: { items: [] }, page: { hasMore: false, nextCursor: null } } }));
  await page.getByRole("button", { name: "换一批" }).click();
  await expect(page.getByText("当前条件下已浏览全部内容。")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新浏览" })).toBeVisible();
  await expect(page.locator(".media-card")).toHaveCount(24);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  const button = await page.getByRole("button", { name: "换一批" }).boundingBox();
  expect(button!.width).toBeGreaterThanOrEqual(44);
  expect(button!.height).toBeGreaterThanOrEqual(44);
});

test("recovers an initial catalogue outage without presenting it as preparing content", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/v1/media?*", (route) => {
    requests += 1;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: { code: "MEDIA_NOT_AVAILABLE" } } })
      : route.fulfill({ json: { apiVersion: "v1", data: { items: cards.slice(0, 24) }, page: { nextCursor: null, hasMore: false } } });
  });
  await page.goto("/learn");
  await expect(page.getByTestId("media-library").getByRole("alert")).toContainText("媒体资料库暂时无法读取");
  await expect(page.getByText("内容准备中", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByTestId("media-library").getByRole("alert")).toContainText("读取失败，请重试。");
  await expect(page.getByText("内容准备中", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".media-card")).toHaveCount(24);
  await expect(page.getByTestId("media-library").getByRole("alert")).toHaveCount(0);
  expect(requests).toBe(2);
});
