import { expect, test, type Page } from "@playwright/test";

const e2eUserId = "00000000-0000-4000-8000-000000000001";
const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([
    { name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl },
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

test("sends with Enter and keeps Shift+Enter available for a newline", async ({ page }) => {
  await authenticate(page);
  await page.goto("/chat/lucia");

  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
  await composer.fill("Hola por teclado");
  await composer.press("Shift+Enter");
  await composer.press("End");
  await composer.press("Enter");

  await expect(page.getByTestId("conversation-thread")).toContainText("Hola por teclado");
  await expect(page.locator('[data-status="completed"]')).toBeVisible({ timeout: 5_000 });
});

test("keeps the page height stable while the message history grows", async ({ page }) => {
  await authenticate(page);
  await page.goto("/chat/lucia");

  const thread = page.getByTestId("conversation-thread");
  const initial = await thread.evaluate((element) => ({
    documentHeight: document.documentElement.scrollHeight,
    threadHeight: Math.round(element.getBoundingClientRect().height),
  }));
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });

  for (const text of ["Hola, mensaje uno", "Hola, mensaje dos", "Hola, mensaje tres"]) {
    await composer.fill(text);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator('[data-status="completed"]')).toBeVisible({ timeout: 5_000 });
  }

  const final = await thread.evaluate((element) => ({
    documentHeight: document.documentElement.scrollHeight,
    threadHeight: Math.round(element.getBoundingClientRect().height),
    messages: (() => {
      const messages = element.querySelector<HTMLElement>(".conversation-thread__messages");
      return messages ? { clientHeight: messages.clientHeight, scrollHeight: messages.scrollHeight } : null;
    })(),
  }));
  expect(final.threadHeight).toBe(initial.threadHeight);
  expect(final.documentHeight).toBeLessThanOrEqual(initial.documentHeight + 2);
  expect(final.messages).not.toBeNull();
  expect(final.messages?.scrollHeight).toBeGreaterThan(final.messages?.clientHeight ?? 0);
});

test("keeps the conversation thread within a phone viewport", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/lucia");
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});
