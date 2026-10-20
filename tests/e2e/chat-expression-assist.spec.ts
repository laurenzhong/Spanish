import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installReadAloud } from "./fixtures/read-aloud";
import { conversationCharacterVersion } from "../../src/modules/conversation/domain/character-catalog";

const e2eUserId = "00000000-0000-4000-8000-000000000001";
const sourceText = "我不是不想去，就是今天有点 cansado，想改天再约。";
const translatedText = "No es que no quiera ir, es que hoy estoy un poco cansado. ¿Quedamos otro día?";
const characterVersion = conversationCharacterVersion("lucia")!;
type AssistRequest = { text: string; characterVersion: number; attemptId: string };
type StreamRequest = { text: string; generationId: string; assistance?: string };

async function authenticate(page: Page, baseURL: string) {
  const streams: StreamRequest[] = [];
  const assists: AssistRequest[] = [];
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: baseURL }]);
  // No unexpected browser API request may reach a real provider or database.
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { error: { code: "e2e-unmocked-api" } } }));
  await page.route("**/api/v1/conversations", (route) => route.fulfill({ json: { data: { conversations: [] } } }));
  await page.route("**/api/v1/character-network/lucia-contact", (route) => route.fulfill({ json: { data: {
    characterKey: "lucia", status: "active", relationshipStage: "familiar", conversationId: "conversation-lucia",
  } } }));
  await page.route("**/api/v1/character-network/introductions", (route) => route.fulfill({ json: { data: { offers: [] } } }));
  await page.route("**/api/v1/conversations/lucia", (route) => route.fulfill({ json: { data: { characterKey: "lucia", messages: [] } } }));
  await page.route("**/api/v1/conversations/lucia/expression-assist", async (route) => {
    const request = route.request().postDataJSON() as AssistRequest;
    assists.push(request);
    await route.fulfill({ json: { apiVersion: "v1", data: { text: translatedText, attemptId: request.attemptId } } });
  });
  await page.route("**/api/v1/conversations/lucia/stream", async (route) => {
    const request = route.request().postDataJSON() as StreamRequest;
    streams.push(request);
    const messageId = `reply-${request.generationId}`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson", "x-conversation-persistence": "available" },
      body: [
        { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion, generationId: request.generationId, messageId },
        { type: "delta", generationId: request.generationId, messageId, text: "Claro, podemos seguir hablando." },
        { type: "done", generationId: request.generationId, messageId },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  await installReadAloud(page);
  return { streams, assists };
}

async function generate(page: Page, text = sourceText) {
  await page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true }).fill(text);
  await page.getByRole("button", { name: "译成西语", exact: true }).click();
  await expect(page.getByRole("region", { name: "翻译预览", exact: true }).getByText(translatedText, { exact: true })).toBeVisible();
}

test("generates, reads and inserts an editable draft before an explicitly assisted send", async ({ page, baseURL }) => {
  const { streams, assists } = await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true });
  await composer.fill("Mi borrador original");
  await generate(page);
  expect(assists).toHaveLength(1);
  expect(assists[0]).toMatchObject({ text: sourceText, characterVersion, attemptId: expect.any(String) });
  expect(Object.keys(assists[0]).sort()).toEqual(["attemptId", "characterVersion", "text"]);
  await expect(composer).toHaveValue(sourceText);
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByText("译文由 AI 生成；填入后可修改，再自行发送。", { exact: true })).toHaveCount(0);
  await expect(page.locator(".conversation-message--user")).toHaveCount(0);
  await expect(page.getByText("本轮已用翻译辅助", { exact: true })).toHaveCount(0);
  expect(streams).toHaveLength(0);

  await page.getByRole("button", { name: "听一遍", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: translatedText, lang: "es-ES" }]);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(1);
  expect(streams).toHaveLength(0);
  await expect(composer).toHaveValue(sourceText);
  await page.getByRole("button", { name: "使用译文", exact: true }).click();
  await expect(page.getByRole("region", { name: "翻译预览", exact: true })).toHaveCount(0);
  await expect(composer).toHaveValue(translatedText);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);
  expect(streams).toHaveLength(0);
  const edited = "Hoy estoy cansado. ¿Te parece si quedamos mañana?";
  await composer.fill(edited);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ text: edited, assistance: "translation" });
  expect(JSON.stringify(streams)).not.toContain(sourceText);
  await expect(page.locator(".conversation-message--user")).toHaveCount(1);
  await expect(page.getByText("翻译辅助", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本轮已用翻译辅助", { exact: true })).toHaveCount(0);

  await composer.fill("¿Qué tal tu día?");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => streams.length).toBe(2);
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  expect(streams[1]).toMatchObject({ text: "¿Qué tal tu día?" });
  expect(streams[1]).not.toHaveProperty("assistance");
});

test("keeps assistance attached when the learner listens, closes and types their own rendition", async ({ page, baseURL }) => {
  const { streams } = await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  await generate(page);
  await page.getByRole("button", { name: "听一遍", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudAudios").length)).toBe(1);
  await page.getByRole("button", { name: "关闭翻译预览", exact: true }).click();
  await expect(page.getByRole("region", { name: "翻译预览", exact: true })).toHaveCount(0);
  await expect(page.getByText("本轮已用翻译辅助", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);
  expect(streams).toHaveLength(0);
  await page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true }).fill("Mejor quedamos otro día, estoy cansado.");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => streams.length).toBe(1);
  expect(streams[0].assistance).toBe("translation");
});

test("preserves private input on a 503 and retries without creating chat messages", async ({ page, baseURL }) => {
  const { streams } = await authenticate(page, baseURL!);
  const attempts: AssistRequest[] = [];
  await page.route("**/api/v1/conversations/lucia/expression-assist", async (route) => {
    const request = route.request().postDataJSON() as AssistRequest;
    attempts.push(request);
    await route.fulfill(attempts.length === 1
      ? { status: 503, json: { error: { code: "provider-unavailable" } } }
      : { json: { apiVersion: "v1", data: { text: translatedText, attemptId: request.attemptId } } });
  });
  await page.goto("/chat/lucia");
  const source = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true });
  await source.fill(sourceText);
  await page.getByRole("button", { name: "译成西语", exact: true }).click();
  const panel = page.getByRole("region", { name: "翻译预览", exact: true });
  await expect(panel.getByRole("alert")).toContainText("保留了你的输入，请重试");
  await expect(source).toHaveValue(sourceText);
  await expect(page.getByText("本轮已用翻译辅助", { exact: true })).toHaveCount(0);
  await expect(page.locator(".conversation-message--user")).toHaveCount(0);
  expect(streams).toHaveLength(0);
  await page.getByRole("button", { name: "重试翻译", exact: true }).click();
  await expect(page.getByRole("region", { name: "翻译预览", exact: true }).getByText(translatedText, { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0].attemptId).not.toBe(attempts[1].attemptId);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(streams).toHaveLength(0);
});

test("ignores a late response after closing and reopening expression assistance", async ({ page, baseURL }) => {
  const { streams } = await authenticate(page, baseURL!);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let intercepted = false;
    window.fetch = (input, init) => {
      if (!intercepted && String(input).endsWith("/expression-assist")) {
        intercepted = true;
        const request = JSON.parse(String(init?.body)) as { attemptId: string };
        // Deliberately ignore AbortSignal to exercise stale generation protection.
        return new Promise<Response>((resolve) => Reflect.set(window, "releaseOldExpressionAssist", () => {
          resolve(Response.json({ apiVersion: "v1", data: { text: "Esta respuesta antigua debe ignorarse.", attemptId: request.attemptId } }));
        }));
      }
      return originalFetch(input, init);
    };
  });
  await page.goto("/chat/lucia");
  await page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true }).fill("旧草稿");
  await page.getByRole("button", { name: "译成西语", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消翻译", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消翻译", exact: true }).click();
  await expect(page.getByText("本轮已用翻译辅助", { exact: true })).toHaveCount(0);
  await generate(page, "新的私有草稿");
  await page.evaluate(async () => {
    Reflect.get(window, "releaseOldExpressionAssist")();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.getByRole("region", { name: "翻译预览", exact: true }).getByText(translatedText, { exact: true })).toBeVisible();
  await expect(page.getByText("Esta respuesta antigua debe ignorarse.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true })).toHaveValue("新的私有草稿");
  await expect(page.locator(".conversation-message--user")).toHaveCount(0);
  expect(streams).toHaveLength(0);
});

test("fits four viewport widths in both themes with 44px targets", async ({ page, baseURL }, testInfo) => {
  const evidenceDirectory = process.env.CHAT_ASSIST_EVIDENCE_DIR ?? testInfo.outputPath("expression-assist");
  await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  await generate(page);
  await mkdir(evidenceDirectory, { recursive: true });
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const panel = page.getByRole("region", { name: "翻译预览", exact: true });
      // Wait for the shared theme transition before checking contrast or capturing evidence.
      await expect(panel).toHaveCSS("background-color",
        theme === "light" ? "rgb(251, 250, 246)" : "rgb(35, 38, 32)");
      await expect(panel.getByRole("button", { name: "使用译文", exact: true })).toHaveCSS("background-color",
        theme === "light" ? "rgb(147, 76, 61)" : "rgb(226, 154, 134)");
      await panel.getByRole("button", { name: "使用译文", exact: true }).scrollIntoViewIfNeeded();
      await expect.poll(() => page.getByRole("textbox").evaluate((input) => input.clientHeight >= 119 || input.scrollHeight <= input.clientHeight + 1)).toBe(true);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(".expression-assist__panel")!;
        const rect = panel.getBoundingClientRect();
        return {
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          panelWidth: panel.clientWidth,
          panelScrollWidth: panel.scrollWidth,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          height: rect.height,
          composerTop: document.querySelector(".conversation-composer__shell")!.getBoundingClientRect().top,
          targets: [...document.querySelectorAll(".conversation-composer button")].map((button) => {
            const target = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return { label: button.getAttribute("aria-label") ?? button.textContent, width: target.width, height: target.height,
              background: style.backgroundColor, color: style.color, opacity: style.opacity, disabled: (button as HTMLButtonElement).disabled };
          }),
        };
      });
      expect(layout.scrollWidth, `${width} ${theme} document overflow`).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.panelScrollWidth, `${width} ${theme} panel overflow`).toBeLessThanOrEqual(layout.panelWidth + 1);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.bottom).toBeLessThanOrEqual(layout.composerTop - 6);
      expect(layout.height).toBeLessThanOrEqual(220);
      expect(layout.targets.length).toBeGreaterThanOrEqual(5);
      for (const target of layout.targets) {
        expect(target.height, `${width} ${theme}: ${target.label} height`).toBeGreaterThanOrEqual(44);
        expect(target.width, `${width} ${theme}: ${target.label} width`).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `${evidenceDirectory}/${testInfo.project.name}-${width}-${theme}.png`, fullPage: false });
      await writeFile(`${evidenceDirectory}/${testInfo.project.name}-${width}-${theme}.json`, JSON.stringify(layout, null, 2));
    }
  }
});

test("uses one composer without auto-generating and discards previews on Escape or draft edits", async ({ page, baseURL }) => {
  const { streams, assists } = await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true });
  const translate = page.getByRole("button", { name: "译成西语", exact: true });
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await translate.click();
  await expect(composer).toBeFocused();
  expect(assists).toHaveLength(0);
  await composer.fill(sourceText);
  expect(assists).toHaveLength(0);
  await translate.click();
  await expect(page.getByRole("region", { name: "翻译预览", exact: true })).toBeVisible();
  await composer.focus();
  await composer.press("Escape");
  await expect(page.getByRole("region", { name: "翻译预览", exact: true })).toHaveCount(0);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(sourceText);
  await translate.click();
  await expect(page.getByRole("region", { name: "翻译预览", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "听一遍", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace").length)).toBe(1);
  await composer.fill("改成明天再约。");
  await expect(page.getByRole("region", { name: "翻译预览", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudPauses"))).toBeGreaterThan(0);
  await composer.evaluate((input) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  expect(streams).toHaveLength(0);
  expect(assists).toHaveLength(2);
});

test("keeps a long translation usable in a short narrow viewport", async ({ page, baseURL }) => {
  const { streams } = await authenticate(page, baseURL!);
  const longTranslation = "Hoy estoy cansado, pero me gustaría quedar contigo otro día. ".repeat(25).trim();
  await page.route("**/api/v1/conversations/lucia/expression-assist", async (route) => {
    const request = route.request().postDataJSON() as AssistRequest;
    await route.fulfill({ json: { apiVersion: "v1", data: { text: longTranslation, attemptId: request.attemptId } } });
  });
  await page.setViewportSize({ width: 320, height: 560 });
  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true });
  await composer.fill(sourceText.repeat(6));
  await page.getByRole("button", { name: "译成西语", exact: true }).click();
  const panel = page.getByRole("region", { name: "翻译预览", exact: true });
  await expect(panel.getByText(longTranslation, { exact: true })).toBeVisible();
  const use = panel.getByRole("button", { name: "使用译文", exact: true });
  await use.scrollIntoViewIfNeeded();
  const layout = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height, viewportHeight: window.innerHeight,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.height).toBeLessThanOrEqual(202);
  expect(layout.scrollWidth).toBeLessThanOrEqual(320);
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);
  await use.click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(longTranslation);
  expect(streams).toHaveLength(0);
});
