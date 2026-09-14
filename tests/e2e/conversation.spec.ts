import { expect, test, type Page } from "@playwright/test";

const e2eUserId = "00000000-0000-4000-8000-000000000001";
const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([
    { name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl },
  ]);
  await page.route("**/api/v1/conversations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          conversations: [{ conversationId: "conversation-lucia", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null }],
        },
      }),
    });
  });
  await page.route("**/api/v1/character-network/lucia-contact", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey: "lucia", status: "active", relationshipStage: "familiar", conversationId: "conversation-lucia" } }) });
  });
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { offers: [] } }) });
  });
  await page.route("**/api/v1/conversations/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const url = new URL(route.request().url());
    const characterKey = url.pathname.split("/").at(-1) ?? "lucia";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey, messages: [] } }) });
  });
  await page.route("**/api/v1/conversations/*/stream", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const request = route.request().postDataJSON() as { generationId: string };
    const characterKey = new URL(route.request().url()).pathname.split("/").at(-2) ?? "lucia";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson", "x-conversation-persistence": "available" },
      body: [
        JSON.stringify({ type: "meta", protocolVersion: "v1", characterKey, characterVersion: 1, generationId: request.generationId, messageId: `reply-${request.generationId}` }),
        JSON.stringify({ type: "delta", generationId: request.generationId, messageId: `reply-${request.generationId}`, text: "Qué alegría leerte." }),
        JSON.stringify({ type: "done", generationId: request.generationId, messageId: `reply-${request.generationId}` }),
      ].join("\n") + "\n",
    });
  });
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey: "lucia", messages: [] } }) });
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey: "lucia", messages: [] } }) });
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
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
  expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.height + 2);
});

test("marks the current contact without wrapping it in a card surface", async ({ page }) => {
  await authenticate(page);
  await page.goto("/chat/lucia");

  const activeContact = page.locator(".conversation-contact-row--active");
  await expect(activeContact).toHaveAttribute("aria-current", "page");
  const appearance = await activeContact.evaluate((element) => {
    const style = getComputedStyle(element);
    const indicator = getComputedStyle(element, "::before");
    const avatar = element.querySelector<HTMLElement>(".avatar");
    const name = element.querySelector<HTMLElement>(".conversation-contact-row__body strong");
    return {
      avatarBoxShadow: avatar ? getComputedStyle(avatar).boxShadow : null,
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      indicatorHeight: Number.parseFloat(indicator.height),
      indicatorOpacity: indicator.opacity,
      indicatorWidth: Number.parseFloat(indicator.width),
      nameIsClipped: name ? name.scrollWidth > name.clientWidth : null,
    };
  });

  expect(appearance.avatarBoxShadow).toBe("none");
  expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
  expect(appearance.borderRadius).toBe("0px");
  expect(appearance.boxShadow).toBe("none");
  expect(appearance.indicatorWidth).toBe(3);
  expect(appearance.indicatorHeight).toBe(28);
  expect(appearance.indicatorOpacity).toBe("1");
  expect(appearance.nameIsClipped).toBe(false);
  await expect(activeContact.getByText("置顶", { exact: true })).toHaveCount(0);
  await expect(activeContact.getByText("开始对话", { exact: true })).toHaveCount(0);
});

test("shows one retry path and disables composing when history is unavailable", async ({ page }) => {
  await authenticate(page);
  let historyAttempts = 0;
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    historyAttempts += 1;
    if (historyAttempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "CONVERSATION_UNAVAILABLE" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey: "lucia", messages: [] } }) });
  });

  await page.goto("/chat/lucia");
  await expect(page.getByTestId("conversation-persistence-status")).toContainText("暂时无法打开这段对话");
  await expect(page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await page.getByTestId("conversation-persistence-status").getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("¡Hola! Cuéntame algo de tu día.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" })).toBeEnabled();
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

test("uses adaptive solid bubbles without decorative image assets", async ({ page }) => {
  await authenticate(page);
  await page.addInitScript(() => window.localStorage.setItem("spanish-theme", "dark"));
  await page.setViewportSize({ width: 1552, height: 838 });
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          characterKey: "lucia",
          messages: [
            { id: "bubble-style-character", role: "character", text: "Hola", complete: true },
            { id: "bubble-style-user", role: "user", text: "Una respuesta breve.", complete: true },
            { id: "bubble-length-character", role: "character", text: "¡Hola! 😊 Me alegra leerte de nuevo, aunque sea solo un saludo.", complete: true },
            { id: "bubble-length-user", role: "user", text: "¡Hola! 😊 Me alegra leerte de nuevo, aunque sea solo un saludo.", complete: true },
            { id: "bubble-long-character", role: "character", text: "Ah, me lo vuelves a contar; antes me dijiste que ya habías vuelto del puerto. ¿Te refieres a volver esta tarde o a otro plan de fotos?", complete: true },
            { id: "bubble-long-user", role: "user", text: "Sí, vuelvo esta tarde; quiero hacer algunas fotos con otra luz.", complete: true },
            { id: "bubble-longer-character", role: "character", text: "Ah, entendido: vuelves esta tarde y quieres probar otra luz. Puede cambiar muchísimo el ambiente de las fotos; seguro que notas nuevos detalles en el puerto.", complete: true },
          ],
        },
      }),
    });
  });

  await page.goto("/chat/lucia");
  await expect(page.locator(".conversation-message__bubble")).toHaveCount(7);
  await expect(page.locator('.conversation-message__bubble[data-fitted="true"]')).toHaveCount(7);
  await expect(page.locator(".conversation-art-bubble")).toHaveCount(0);
  await expect(page.locator(".conversation-message__bubble img")).toHaveCount(0);
  const bubbles = await page.locator(".conversation-message__bubble").evaluateAll((elements) => elements.map((element) => {
    const text = element.querySelector<HTMLElement>(".conversation-message__text");
    return {
      background: getComputedStyle(element).backgroundColor,
      width: element.getBoundingClientRect().width,
      textWrapStyle: text ? getComputedStyle(text).textWrapStyle : "",
    };
  }));
  expect(bubbles[0].background).not.toBe("rgba(0, 0, 0, 0)");
  expect(bubbles[1].background).not.toBe("rgba(0, 0, 0, 0)");
  expect(bubbles[0].width).toBeLessThan(220);
  expect(bubbles[1].width).toBeLessThan(260);
  expect(bubbles[2].width).toBeLessThanOrEqual(360);
  expect(bubbles[3].width).toBeLessThanOrEqual(360);
  expect(bubbles[2].textWrapStyle).toBe("balance");
  expect(bubbles[3].textWrapStyle).toBe("balance");
  const fittedSpacing = await page.locator(".conversation-message__bubble").evaluateAll((elements) => elements.slice(2).map((element) => {
    const bubble = element as HTMLElement;
    const text = bubble.querySelector<HTMLElement>(".conversation-message__text");
    if (!text) throw new Error("message text is missing");
    const range = document.createRange();
    range.selectNodeContents(text);
    const fragments = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
    if (fragments.length === 0) throw new Error("message text has no rendered fragments");
    const bubbleRect = bubble.getBoundingClientRect();
    const style = getComputedStyle(bubble);
    return {
      bubbleWidth: bubbleRect.width,
      inlineSize: style.inlineSize,
      maxInlineSize: style.maxInlineSize,
      leftGap: Math.min(...fragments.map((rect) => rect.left)) - bubbleRect.left,
      rightGap: bubbleRect.right - Math.max(...fragments.map((rect) => rect.right)),
      expectedLeftGap: Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth),
      expectedRightGap: Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth),
      lineWidths: fragments.map((rect) => rect.width),
    };
  }));
  for (const [index, spacing] of fittedSpacing.entries()) {
    const diagnostic = `bubble ${index + 2} spacing: ${JSON.stringify(spacing)}`;
    expect(Math.abs(spacing.leftGap - spacing.expectedLeftGap), diagnostic).toBeLessThanOrEqual(2);
    expect(Math.abs(spacing.rightGap - spacing.expectedRightGap), diagnostic).toBeLessThanOrEqual(2);
  }
});

test("opens the mobile conversation list without a redundant back link", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/lucia");

  await expect(page.getByRole("link", { name: "返回对话列表" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开会话列表" }).click();
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
  await page.getByRole("button", { name: "更多对话操作" }).click();
  await page.getByRole("menuitem", { name: "搜索消息" }).click();
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
  await page.addInitScript(() => window.localStorage.setItem("spanish-theme", "dark"));
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
  const bubbleBox = await message.locator(".conversation-message__bubble").boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(bubbleBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(menuBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(156);
  expect(menuBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((viewport?.width ?? 0) < 600 ? 196 : 156);
  expect(Math.abs((menuBox?.x ?? 0) + (menuBox?.width ?? 0) - ((bubbleBox?.x ?? 0) + (bubbleBox?.width ?? 0)))).toBeLessThanOrEqual(1);
  expect(menuBox?.y ?? 0).toBeGreaterThanOrEqual((bubbleBox?.y ?? 0) + (bubbleBox?.height ?? 0) + 5);
  await expect(messageMenu).toHaveCSS("background-color", "rgb(48, 52, 45)");
  await expect(page.getByRole("menuitem", { name: "复制" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "转发" })).toHaveCount(0);
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
