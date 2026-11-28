import { expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000001";
const contacts = ["Lucía Martín", "Mateo", "Inés"].map((characterName, index) => {
  const characterKey = ["lucia", "mateo", "ines"][index];
  return { conversationId: `conversation-${characterKey}`, characterKey, characterName, avatarClass: `avatar--${characterKey}`, roleLabel: "好友", lastMessageAt: null, lastMessage: null };
});

async function authenticate(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: userId, url: baseURL }]);
  await page.route("**/api/v1/conversations", (route) => route.fulfill({ json: { data: { conversations: contacts } } }));
  await page.route("**/api/v1/character-network/lucia-contact", (route) => route.fulfill({ json: { data: {
    characterKey: "lucia", status: "active", relationshipStage: "familiar", conversationId: "conversation-lucia",
  } } }));
  await page.route("**/api/v1/character-network/introductions", (route) => route.fulfill({ json: { data: { offers: [] } } }));
  await page.route("**/api/v1/conversations/lucia", (route) => route.fulfill({ json: { data: {
    characterKey: "lucia",
    messages: [
      { id: "hello-user", role: "user", text: "Hola, ¿qué tal?", complete: true },
      { id: "hello-character", role: "character", text: "Muy bien, gracias.", complete: true },
    ],
  } } }));
}

test.beforeEach(({ isMobile }) => test.skip(!isMobile, "Requires a touch device profile"));

test("opens and uses the conversation list from a thread on touch", async ({ page, baseURL }) => {
  await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  const open = page.getByRole("button", { name: "打开会话列表" });
  await open.tap();
  const sheet = page.getByRole("dialog", { name: "会话列表" });
  const contacts = sheet.getByRole("navigation", { name: "好友列表" });
  await expect(contacts).toBeVisible();
  await contacts.getByRole("link", { name: /Lucía/ }).tap();
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
  await open.tap();
  await sheet.getByRole("button", { name: "关闭会话列表" }).tap();
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
});

test("keeps the last conversation tappable in landscape", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await authenticate(page, baseURL!);
  await page.goto("/chat");
  const link = page.getByRole("navigation", { name: "好友列表" }).getByRole("link", { name: /Inés/ });
  await link.tap({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/chat\/ines$/);
});

test("offers a visible touch target for both message action menus", async ({ page, baseURL }) => {
  await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  const characterAction = page.locator('[data-message-id="hello-character"]').getByRole("button", { name: "消息操作", exact: true });
  await expect(characterAction).toBeVisible();
  const size = (await characterAction.boundingBox())!;
  expect(Math.round(Math.min(size.width, size.height))).toBeGreaterThanOrEqual(44);
  await characterAction.tap();
  const characterMenu = page.getByRole("menu", { name: /Lucía.*消息操作/ });
  await expect(characterMenu.getByRole("menuitem", { name: "翻译" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(characterAction).toBeFocused();
  const ownAction = page.locator('[data-message-id="hello-user"]').getByRole("button", { name: "消息操作", exact: true });
  await ownAction.tap();
  const ownMenu = page.getByRole("menu", { name: "你的消息操作" });
  await expect(ownMenu.getByRole("menuitem", { name: "朗读" })).toBeVisible();
  await expect(ownMenu.getByRole("menuitem", { name: "删除" })).toBeVisible();
});

test("keeps chat and assistant send controls above the software keyboard", async ({ page, baseURL }) => {
  await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: /写下你想对 Lucía/ });
  await composer.tap();
  await composer.fill("Hola");
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, value: 370 });
    viewport.dispatchEvent(new Event("resize"));
  });
  const send = page.getByRole("button", { name: "发送消息" });
  await expect.poll(async () => {
    const rect = (await send.boundingBox())!;
    return rect.y + rect.height;
  }).toBeLessThanOrEqual(370);
  await page.getByRole("button", { name: "更多对话操作" }).tap();
  await page.getByRole("menuitem", { name: "AI 助手" }).tap();
  const panel = page.getByRole("dialog", { name: /AI 助手/ });
  await panel.getByRole("textbox", { name: "向 AI 助手提问" }).fill("¿Cómo?");
  const ask = panel.getByRole("button", { name: "问一下" });
  await expect.poll(async () => {
    const rect = (await ask.boundingBox())!;
    return rect.y + rect.height;
  }).toBeLessThanOrEqual(370);
  await panel.getByRole("button", { name: "关闭 AI 助手" }).tap();
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, "height");
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("product-shell")).not.toHaveAttribute("data-chat-keyboard");
  await expect(page.getByRole("link", { name: "我的", exact: true })).toBeVisible();
});

test("opens account, profile and help from the mobile My tab", async ({ page, baseURL }) => {
  await authenticate(page, baseURL!);
  await page.goto("/me");
  const open = page.getByRole("button", { name: "账户设置" });
  await open.tap({ timeout: 5_000 });
  const menu = page.getByRole("menu", { name: "账户菜单" });
  await expect(menu.getByRole("menuitem", { name: "退出登录" })).toBeVisible();
  await menu.getByRole("button", { name: "切换到深色模式" }).tap();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await menu.getByRole("menuitem", { name: "编辑个人资料" }).tap();
  await expect(page).toHaveURL(/\/me\/profile$/);
  await page.goto("/me");
  await open.tap();
  await page.getByRole("menu", { name: "账户菜单" }).getByRole("menuitem", { name: "帮助与反馈" }).tap();
  await expect(page.getByRole("heading", { name: "帮助与反馈" })).toBeVisible();
});

test("taps through all five primary sections and keeps their bottom navigation in view", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await authenticate(page, baseURL!);
  await page.goto("/learn");
  for (const [label, path] of [["阅读", "/read"], ["探索", "/explore"], ["对话", "/chat"], ["我的", "/me"], ["学习", "/learn"]]) {
    const link = page.getByRole("link", { name: label, exact: true });
    await link.tap();
    await expect(page).toHaveURL(new URL(path, baseURL).href);
    await expect(link).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  }
});

test("keeps article note editing and saving inside the visible viewport", async ({ page, baseURL }) => {
  await authenticate(page, baseURL!);
  await page.goto("/read/article/article.sueno-first-cafe@1");
  await page.getByRole("button", { name: "收藏", exact: true }).tap();
  const panel = page.getByRole("dialog", { name: "收藏" });
  const input = panel.getByRole("textbox", { name: "文章个人笔记" });
  await input.tap();
  await input.fill("Una nota.");
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, value: 320 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => {
    const rect = (await panel.boundingBox())!;
    return rect.y + rect.height;
  }).toBeLessThanOrEqual(320);
  expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await panel.getByRole("button", { name: "保存笔记" }).tap();
  await expect(page.getByText("笔记已保存在阅读状态中。", { exact: true })).toBeVisible();
});
