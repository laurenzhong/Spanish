import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: "00000000-0000-4000-8000-000000000001",
      url: e2eBaseUrl,
    },
  ]);
}

test("opens the immersive content pack as one recoverable path", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore/packs/immersive.first-cafe-conversation");

  await expect(page.getByRole("heading", { name: "咖啡馆里的新朋友" })).toBeVisible();
  await expect(page.getByText("0/6 个步骤")).toBeVisible();
  await expect(page.getByRole("button", { name: "播放全文" })).toBeVisible();
  await expect(page.getByText("Después de clase", { exact: false })).not.toBeVisible();

  await page.getByRole("button", { name: "展开西语和中文" }).first().click();
  await expect(page.getByText("Después de clase", { exact: true })).toBeVisible();
  await expect(page.getByText("下课后，Marta 走进校园咖啡馆。", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入口语复核" })).toHaveAttribute(
    "href",
    "/learn/practice",
  );
});

test("keeps the content pack inside a narrow viewport", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore/packs/immersive.first-cafe-conversation");

  await expect(page.locator(".content-pack-page")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});
