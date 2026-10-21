import { expect, test } from "@playwright/test";

test("restores shelf navigation and spacing when leaving an article", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
  await page.route("**/api/v1/read/articles/**/state", (route) => route.fulfill({ json: { data: null } }));
  await page.goto("/read/article/article.sueno-first-cafe@1");
  const navigation = page.getByRole("navigation", { name: "阅读内容类型" });
  await expect(navigation).toHaveCount(0);
  await page.locator(".article-reader__back").click();
  await expect(page).toHaveURL(/\/read$/);
  await expect(page.locator(".article-reader")).toHaveCount(0);
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "文章", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(navigation).toHaveCSS("position", "relative");
  await expect(page.locator(".product-content")).toHaveCSS("padding-left", "20px");
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 375, 768, 960, 1440, 1920]) {
    test(`article chrome stays aligned at ${width}px in ${theme} theme`, async ({ page, baseURL }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
      await page.addInitScript((value) => localStorage.setItem("spanish-theme", value), theme);
      // Layout checks never persist progress or call explanation providers.
      await page.route("**/api/v1/read/articles/**/state", (route) => route.fulfill({ json: { data: null } }));
      await page.route("**/api/v1/read/word-explanation", (route) => route.fulfill({ status: 503, json: {} }));
      await page.goto("/read/article/article.sueno-first-cafe@1");
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      const navigation = page.getByRole("navigation", { name: "阅读内容类型" });
      await expect(navigation).toHaveCount(0);
      const toolbar = page.locator(".article-reader__topbar");
      await expect(toolbar).toBeVisible();
      await expect.poll(async () => page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const bar = box(".article-reader__topbar");
        const main = box(".product-content");
        const reader = box(".article-reader");
        const body = box(".article-reader__body");
        const title = box(".article-reader__topbar-title");
        const actions = box(".article-reader__topbar-actions");
        const back = box(".article-reader__back");
        return {
          toolbarAtTop: Math.abs(bar.top) < 1,
          alignedSides: Math.abs(main.left - reader.left) < 1 && Math.abs(main.right - reader.right) < 1 && Math.abs(main.left - bar.left) < 1 && Math.abs(main.right - bar.right) < 1,
          bodyBelowToolbar: body.top >= bar.bottom,
          titleFits: title.right <= actions.left + 1 && title.left >= back.right - 1,
          noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      })).toEqual({ toolbarAtTop: true, alignedSides: true, bodyBelowToolbar: true, titleFits: true, noOverflow: true });
      await page.screenshot({ path: testInfo.outputPath("article.png") });
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(navigation).toHaveCount(0);
      await expect.poll(() => toolbar.evaluate((node) => Math.round(node.getBoundingClientRect().top))).toBe(0);
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const tools = page.getByRole("dialog", { name: "设置" });
      await expect(tools).toBeVisible();
      const barBox = await toolbar.boundingBox();
      const toolsBox = await tools.boundingBox();
      expect(toolsBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
      if (width >= 1200) {
        await page.locator(".article-reader__topbar-title").click();
        await page.locator(".reader-token").first().click();
        const handle = page.getByTestId("translator-drag-handle");
        const handleBox = (await handle.boundingBox())!;
        await page.mouse.move(handleBox.x + 24, handleBox.y + 20);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + 24, 0);
        await page.mouse.up();
        const translator = page.getByRole("dialog", { name: "解释" });
        await expect.poll(() => translator.evaluate((node) => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(64);
      }
    });
  }
}
