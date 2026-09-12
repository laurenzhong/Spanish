import { expect, test, type Page } from "@playwright/test";

const baseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const widths = [320, 375, 414, 768, 1024, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseUrl }]);
}

test("keeps reading and profile surfaces usable across the UI-011 viewport matrix", async ({ page }) => {
  await authenticate(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/read", "/read/article/article.sueno-first-cafe@1", "/me"]) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
      const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll, `${route} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    }
  }
});

test("restores focus when the mobile reading assist drawer closes", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/read/article/article.sueno-first-cafe@1");
  const toggle = page.getByRole("button", { name: "解释" });
  await toggle.focus();
  await toggle.click();
  const dialog = page.getByRole("dialog", { name: "解释" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".article-reader__tools-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toggle).toBeFocused();
});
