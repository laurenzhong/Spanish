import { expect, test, type Page } from "@playwright/test";

const e2eUserId = "00000000-0000-4000-8000-000000000001";

async function authenticate(page: Page) {
  await page.context().addCookies([
    { name: "spanish-e2e-user", value: e2eUserId, domain: "localhost", path: "/" },
  ]);
}

test("sends a message and completes the Lucía stream", async ({ page }) => {
  await authenticate(page);
  await page.goto("/chat/lucia");

  await page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" }).fill("Hola, Lucía");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByTestId("conversation-thread")).toContainText("Hola, Lucía");
  await expect(page.getByTestId("conversation-thread")).toContainText("Qué alegría", { timeout: 5_000 });
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.locator('.conversation-message--character[data-complete="true"]')).toBeVisible();
});
test("keeps the conversation thread within a phone viewport", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/lucia");
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});
