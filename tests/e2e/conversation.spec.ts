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

test("offers retry when the stream fails before the first character event", async ({ page }) => {
  await authenticate(page);
  let attempts = 0;
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not configured" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/conversations/lucia/stream", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary" }) });
      return;
    }
    const body = route.request().postDataJSON() as { generationId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: body.generationId, messageId: "retry-message" }),
        JSON.stringify({ type: "delta", generationId: body.generationId, messageId: "retry-message", text: "¡Hola de nuevo!" }),
        JSON.stringify({ type: "done", generationId: body.generationId, messageId: "retry-message" }),
      ].join("\n") + "\n",
    });
  });

  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
  await composer.fill("Hola, Lucía");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-status="failed"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "重新发送" })).toBeVisible();

  await page.getByRole("button", { name: "重新发送" }).click();
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.locator(".conversation-message--user")).toHaveCount(1);
  await expect(page.locator('.conversation-message--character[data-complete="true"]')).toContainText("Hola de nuevo");
});

test("can stop before the first character event and retry the same user message", async ({ page }) => {
  await authenticate(page);
  let attempts = 0;
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not configured" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/conversations/lucia/stream", async (route) => {
    attempts += 1;
    const body = route.request().postDataJSON() as { generationId: string };
    if (attempts === 1) {
      await new Promise(() => {});
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: body.generationId, messageId: "stopped-message" }),
        JSON.stringify({ type: "delta", generationId: body.generationId, messageId: "stopped-message", text: "Seguimos hablando." }),
        JSON.stringify({ type: "done", generationId: body.generationId, messageId: "stopped-message" }),
      ].join("\n") + "\n",
    });
  });

  await page.goto("/chat/lucia");
  await page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" }).fill("Hola, Lucía");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect(page.locator('[data-status="cancelled"]')).toBeVisible();
  await page.getByRole("button", { name: "重新发送" }).click();
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.locator(".conversation-message--user")).toHaveCount(1);
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

  for (const text of [
    "Hola, este es un mensaje bastante largo para comprobar que el historial mantiene una zona de desplazamiento estable.",
    "Hola, sigo conversando sobre mi día y añado suficiente contexto para que la lista de mensajes pueda crecer de forma visible.",
    "Hola, este tercer mensaje continúa la conversación con otra frase larga para validar el comportamiento cuando el historial se desborda.",
  ]) {
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

test("keeps sent messages right anchored while their text stays left aligned", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          characterKey: "lucia",
          messages: [
            { id: "layout-character", role: "character", text: "¡Hola!", complete: true, createdAt: "2026-08-28T01:01:00.000Z" },
            { id: "layout-short", role: "user", text: "Hola", complete: true, createdAt: "2026-08-28T01:02:00.000Z" },
            { id: "layout-multiline", role: "user", text: "Primera línea\nSegunda línea", complete: true, createdAt: "2026-08-28T01:08:00.000Z" },
          ],
        },
      }),
    });
  });

  await page.goto("/chat/lucia");
  const sent = page.locator(".conversation-message--user");
  await expect(sent).toHaveCount(2);
  await expect(page.locator(".conversation-message__avatar")).toHaveCount(3);
  await expect(page.locator(".conversation-message__bubble")).toHaveCount(3);
  await expect(page.locator(".conversation-thread__timestamp")).toHaveCount(2);
  await expect(page.locator(".conversation-message__time")).toHaveCount(0);

  const metrics = await sent.evaluateAll((elements) => elements.map((element) => {
    const message = element as HTMLElement;
    const text = message.querySelector<HTMLElement>(".conversation-message__text");
    const messageRect = message.getBoundingClientRect();
    const threadRect = message.parentElement?.getBoundingClientRect();
    const threadStyle = message.parentElement ? getComputedStyle(message.parentElement) : null;
    const contentRight = threadRect && threadStyle
      ? threadRect.right - Number.parseFloat(threadStyle.paddingRight)
      : Number.POSITIVE_INFINITY;
    return {
      rightGap: Math.abs(contentRight - messageRect.right),
      width: messageRect.width,
      textAlign: text ? getComputedStyle(text).textAlign : "",
      whiteSpace: text ? getComputedStyle(text).whiteSpace : "",
    };
  }));

  expect(metrics[0].rightGap).toBeLessThanOrEqual(1);
  expect(metrics[0].width).toBeLessThan(metrics[1].width);
  expect(metrics[1].textAlign).toBe("left");
  expect(metrics[1].whiteSpace).toBe("pre-wrap");

  await sent.nth(0).click();
  await expect(page.locator(".conversation-thread__timestamp--exact")).toHaveCount(1);
});

test("applies and restores the selected user bubble style", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          characterKey: "lucia",
          messages: [{ id: "bubble-style-user", role: "user", text: "Hola", complete: true }],
        },
      }),
    });
  });

  await page.goto("/chat/lucia");
  const userMessage = page.locator(".conversation-message--user");
  await expect(userMessage.locator(".conversation-art-bubble--dog-long")).toBeVisible();

  await page.evaluate(() => {
    window.localStorage.setItem("sueno-chat-bubble-style", "pink-frog");
    window.dispatchEvent(new CustomEvent("chat-bubble-style-updated", { detail: "pink-frog" }));
  });
  await expect(userMessage.locator(".conversation-art-bubble--pink")).toBeVisible();

  await page.reload();
  await expect(page.locator(".conversation-message--user .conversation-art-bubble--pink")).toBeVisible();
});

test("opens the mobile conversation list without a redundant back link", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/lucia");

  await expect(page.getByRole("link", { name: "返回对话列表" })).toHaveCount(0);
  await page.getByRole("button", { name: "会话列表" }).click();
  await expect(page.getByRole("dialog", { name: "会话列表" })).toBeVisible();
});

test("searches conversation history and opens the matching message", async ({ page }) => {
  await authenticate(page);
  const messageId = "00000000-0000-4000-8000-000000000099";
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { characterKey: "lucia", messages: [{ id: messageId, role: "character", text: "Hablamos del café de Madrid.", complete: true }] } }),
    });
  });
  await page.route("**/api/v1/conversations/search?q=caf%C3%A9", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { query: "café", results: [{ messageId, characterKey: "lucia", characterName: "Lucía Martín", role: "character", snippet: "Hablamos del café de Madrid.", createdAt: "2026-08-27T00:00:00.000Z" }] } }),
    });
  });

  await page.goto("/chat");
  await page.getByRole("searchbox", { name: "搜索对话" }).fill("café");
  await page.getByRole("button", { name: "提交对话搜索" }).click();
  await expect(page.getByRole("link", { name: /Hablamos del café/ })).toBeVisible();
  await page.getByRole("link", { name: /Hablamos del café/ }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/lucia\\?message=${messageId}`));
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toHaveAttribute("data-highlighted", "true");
});

test("renders the selected character identity for Mateo and Inés", async ({ page }) => {
  await authenticate(page);
  for (const character of [{ key: "mateo", name: "Mateo Ruiz" }, { key: "ines", name: "Inés García" }]) {
    await page.goto(`/chat/${character.key}`);
    await expect(page.getByRole("heading", { name: character.name })).toBeVisible();
    await expect(page.getByRole("textbox", { name: `写下你想对 ${character.name} 说的话` })).toBeVisible();
  }
});

test("opens sent-message actions and marks a withdrawn message without memory text", async ({ page }) => {
  await authenticate(page);
  const messageId = "00000000-0000-4000-8000-000000000123";
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { characterKey: "lucia", messages: [{ id: messageId, role: "user", text: "Me gusta el senderismo", complete: true, status: "completed" }] } }),
    });
  });
  await page.route(`**/api/v1/conversations/lucia/messages/${messageId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { withdrawn: true } }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/chat/lucia");
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await message.click({ button: "right" });
  const messageMenu = page.getByRole("menu", { name: "你的消息操作" });
  await expect(messageMenu).toBeVisible();
  const menuBox = await messageMenu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
  await expect(page.getByRole("menuitem", { name: "复制" })).toBeVisible();
  await page.getByRole("menuitem", { name: "引用回复" }).click();
  await expect(page.getByTestId("conversation-composer-quote")).toContainText("Me gusta el senderismo");
  await message.click({ button: "right" });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("menuitem", { name: "撤回" }).click();
  await expect(message).toHaveAttribute("data-withdrawn", "true");
  await expect(message).toContainText("你撤回了一条消息");
  await expect(page.getByText("不会用于记忆或学习数据")).toBeVisible();
});

test("opens friend-message actions on double click and translates inline", async ({ page }) => {
  await authenticate(page);
  const messageId = "00000000-0000-4000-8000-000000000124";
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { characterKey: "lucia", messages: [{ id: messageId, role: "character", text: "Nos vemos mañana.", complete: true }] } }),
    });
  });
  await page.route("**/api/v1/conversations/translation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { text: "明天见。" } }),
    });
  });
  await page.goto("/chat/lucia");
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await message.dblclick();
  await expect(page.getByRole("menu", { name: "Lucía Martín 的消息操作" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "复制" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "翻译" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "引用回复" })).toBeVisible();
  await page.getByRole("menuitem", { name: "翻译" }).click();
  await expect(message).toContainText("明天见。", { timeout: 5_000 });
  await message.dblclick();
  await page.getByRole("menuitem", { name: "取消翻译" }).click();
  await expect(message).not.toContainText("明天见。");
  await expect(page.getByRole("menu", { name: "Lucía Martín 的消息操作" })).toHaveCount(0);
});
