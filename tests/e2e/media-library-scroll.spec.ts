import { expect, test } from "@playwright/test";
import { selectMediaBrowsePage } from "../../src/modules/media/domain/media-browse";
import type { MediaCard } from "../../src/modules/media/domain";

const cards: MediaCard[] = Array.from({ length: 240 }, (_, index) => ({
  id: `media.scroll.${index}@1`, stableKey: `media.scroll.${index}`, version: 1, kind: "podcast",
  title: `Episode ${index}`, summary: "", sourceName: `Radio ${index % 4}`, language: "es", region: "es-ES", cefr: "B1",
  topics: [], durationMs: 120_000, publishedAt: null, curatedAt: "2026-10-13T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
}));

test("reloads a batch and scrolls through the entire catalogue with bounded history writes", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  if (!test.info().project.name.includes("mobile")) await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
  await page.route("**/api/v1/media/browse", (route) => {
    const result = selectMediaBrowsePage(cards, route.request().postDataJSON());
    return route.fulfill({ json: { apiVersion: "v1", data: { items: result.items }, page: { nextCursor: result.nextCursor, hasMore: result.hasMore } } });
  });
  // Use the browser's real IntersectionObserver; no manual load-more clicks.
  await page.goto("/learn");
  await page.getByRole("button", { name: "换一批" }).click();
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveValue("browse");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "排序" })).toHaveValue("browse");
  for (let pageIndex = 0; pageIndex < 12; pageIndex++) {
    const count = await page.locator(".media-card").count();
    if (count === cards.length) break;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.locator(".media-card").count(), { timeout: 8000 }).toBeGreaterThan(count);
  }
  await expect(page.locator(".media-card")).toHaveCount(cards.length);
  const hrefs = await page.locator(".media-card__link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(cards.length);
  await expect(page.getByRole("button", { name: "加载更多", exact: true })).toHaveCount(0);

  const scroll = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const original = window.history.replaceState.bind(window.history);
    let writes = 0;
    window.history.replaceState = (...args) => { writes += 1; original(...args); };
    const started = performance.now();
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame);
      window.scrollBy(0, 40);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    window.history.replaceState = original;
    return { writes, elapsed: performance.now() - started, actual: window.scrollY, saved: window.history.state?.mediaBrowse?.scrollY };
  });
  expect(scroll.writes).toBeLessThanOrEqual(Math.ceil(scroll.elapsed / 200) + 2);
  expect(scroll.saved).toBe(scroll.actual);
  console.log(JSON.stringify({ viewport: page.viewportSize()?.width, cards: hrefs.length, scrollFrames: 30, historyWrites: scroll.writes, elapsedMs: Math.round(scroll.elapsed) }));
});
