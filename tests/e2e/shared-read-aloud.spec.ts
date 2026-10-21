import { expect, test } from "@playwright/test";
import { installReadAloud } from "./fixtures/read-aloud";

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
  await installReadAloud(page);
});

test("uses shared female-voice synthesis for vocabulary word buttons and releases playback on close", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sueno:vocabulary-autoplay:v1:00000000-0000-4000-8000-000000000001", "off"));
  await page.goto("/read/vocabulary?search=casa");
  await page.locator('[data-word="casa"]').first().click();
  const panel = page.locator(".vocabulary-study__card");
  await panel.getByRole("button", { name: "朗读单词", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: "casa", lang: "es-ES" }]);
  await expect(panel.getByRole("button", { name: "停止朗读", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);
});

test("uses the same endpoint for scenario reference expressions", async ({ page }) => {
  await page.goto("/explore/scenarios/scenario.campus-administration");
  const button = page.getByRole("button", { name: /^朗读表达：/u }).first();
  const expected = (await button.getAttribute("aria-label"))!.replace("朗读表达：", "");
  await button.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: expected, lang: "es-ES" }]);
  await page.getByRole("button", { name: `停止朗读：${expected}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);
});

test("reads completed private chat messages through the authenticated shared endpoint", async ({ page }) => {
  const messageId = "00000000-0000-4000-8000-000000000124";
  const userMessageId = "00000000-0000-4000-8000-000000000125";
  await page.route("**/api/v1/conversations", (route) => route.fulfill({ json: { data: { conversations: [] } } }));
  await page.route("**/api/v1/character-network/lucia-contact", (route) => route.fulfill({ json: { data: { characterKey: "lucia", status: "active", relationshipStage: "familiar", conversationId: "conversation-lucia" } } }));
  await page.route("**/api/v1/character-network/introductions", (route) => route.fulfill({ json: { data: { offers: [] } } }));
  await page.route("**/api/v1/conversations/lucia", (route) => route.fulfill({ json: { data: { characterKey: "lucia", messages: [
    { id: messageId, role: "character", text: "Nos vemos mañana.", complete: true },
    { id: userMessageId, role: "user", text: "Me gusta el senderismo", complete: true },
  ] } } }));
  await page.goto("/chat/lucia");
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await message.dblclick();
  await page.getByRole("menuitem", { name: "朗读", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: "Nos vemos mañana.", lang: "es-ES" }]);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(1);
  await message.dblclick();
  await page.getByRole("menuitem", { name: "停止朗读", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);

  // The learner's own message has the same menu action so they can re-listen to
  // their Spanish; it still goes through the authenticated shared endpoint.
  const userMessage = page.locator(`[data-message-id="${userMessageId}"]`);
  await userMessage.click({ button: "right" });
  await page.getByRole("menuitem", { name: "朗读", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([
    { text: "Nos vemos mañana.", lang: "es-ES" },
    { text: "Me gusta el senderismo", lang: "es-ES" },
  ]);
});
