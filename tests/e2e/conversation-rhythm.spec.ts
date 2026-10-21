import { expect, test, type Page } from "@playwright/test";
import type { ConversationMessage } from "../../src/modules/conversation/domain/conversation-state";

type PendingMessage = { text: string; clientMessageId: string };
type RhythmRequest = PendingMessage & { generationId: string; pendingMessages?: PendingMessage[]; supersedes?: { generationId: string; visibleBubbleCount: number } };
type RhythmBrowser = Window & { rhythm: { requests: RhythmRequest[]; controllers: ReadableStreamDefaultController<Uint8Array>[]; cancelled: number[]; emit: (index: number, texts: string[], done?: boolean) => void } };

async function setup(page: Page, history: readonly ConversationMessage[] = []) {
  const baseURL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3101}`;
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL }]);
  await page.route("**/api/v1/conversations", async (route) => route.fulfill({ json: { data: { conversations: [{ conversationId: "rhythm-conversation", characterKey: "lucia", characterName: "Lucía Martín", roleLabel: "主要好友", avatarClass: "avatar--lucia", lastMessageAt: null, lastMessage: null }] } } }));
  await page.route("**/api/v1/character-network/lucia-contact", async (route) => route.fulfill({ json: { data: { characterKey: "lucia", status: "active", relationshipStage: "new_contact", conversationId: "rhythm-conversation" } } }));
  await page.route("**/api/v1/character-network/introductions", async (route) => route.fulfill({ json: { data: { offers: [] } } }));
  await page.route("**/api/v1/conversations/lucia", async (route) => route.fulfill({ json: { data: { messages: history, readOnly: false, canSend: true, contactStatus: "active" } } }));
  await page.addInitScript(() => {
    const browser = window as unknown as RhythmBrowser;
    const actualFetch = window.fetch.bind(window);
    browser.rhythm = {
      requests: [], controllers: [], cancelled: [],
      emit(index, texts, done = true) {
        const request = this.requests[index]!;
        const ids = { generationId: request.generationId, messageId: `rhythm-${request.generationId}` };
        const events = [
          { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 3, ...ids },
          ...texts.map((text, i) => ({ type: "delta", ...ids, text: i > 0 ? `\n\n${text}` : text })),
          ...(done ? [{ type: "done", ...ids }] : []),
        ];
        for (const event of events) this.controllers[index]!.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
        if (done) this.controllers[index]!.close();
      },
    };
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/conversations/lucia/stream") && init?.method === "POST") {
        const index = browser.rhythm.requests.length;
        browser.rhythm.requests.push(JSON.parse(String(init.body)) as RhythmRequest);
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { browser.rhythm.controllers[index] = controller; },
          cancel() { browser.rhythm.cancelled.push(index); },
        }), { headers: { "content-type": "application/x-ndjson", "x-conversation-persistence": "available" } });
      }
      return actualFetch(input, init);
    };
  });
  await page.goto("/chat/lucia");
  await expect(page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" })).toBeEnabled();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" }).fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
}
async function requests(page: Page) { return page.evaluate(() => (window as unknown as RhythmBrowser).rhythm.requests); }
async function emit(page: Page, index: number, texts: string[], done = true) {
  await page.evaluate(({ index, texts, done }) => (window as unknown as RhythmBrowser).rhythm.emit(index, texts, done), { index, texts, done });
}

test("natural four bubbles preserve one logical turn and a single newline", async ({ page }, testInfo) => {
  await setup(page); await send(page, "Explícame cuatro cosas.");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await emit(page, 0, ["Primera.\nSigue aquí.", "Segunda.", "Tercera.", "Cuarta."]);
  const message = page.locator(".conversation-message--character");
  await expect(message).toHaveCount(1);
  await expect(message.locator(".conversation-message__bubble")).toHaveCount(4);
  await expect(message).toHaveAttribute("data-complete", "true");
  await expect(message.locator(".conversation-message__bubble").first()).toContainText("Sigue aquí.");
  const shortBubble = await message.locator(".conversation-message__bubble").nth(1).evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    padding: parseFloat(getComputedStyle(element).paddingTop) + parseFloat(getComputedStyle(element).paddingBottom),
  }));
  expect(shortBubble.height).toBeLessThanOrEqual(shortBubble.lineHeight + shortBubble.padding + 3);
  await page.screenshot({ path: testInfo.outputPath(`synthetic-bubbles-${testInfo.project.name}.png`), fullPage: true });
});

test("follow-up combines photography and a book while preserving delivered bubbles", async ({ page }) => {
  await setup(page); await send(page, "Me gusta la fotografía urbana.");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await emit(page, 0, ["Me gusta fijarme en los detalles de la ciudad."], false);
  await expect(page.getByText("Me gusta fijarme en los detalles de la ciudad.", { exact: true })).toBeVisible();
  await send(page, "He comprado un libro.");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  const bodies = await requests(page);
  expect(bodies[1]?.pendingMessages).toEqual([{ text: "Me gusta la fotografía urbana.", clientMessageId: bodies[0]!.clientMessageId }]);
  expect(bodies[1]?.supersedes).toEqual({ generationId: bodies[0]!.generationId, visibleBubbleCount: 1 });
  await emit(page, 1, ["¿Un libro de fotografía o de otra cosa?"]);
  await expect(page.getByText("Me gusta fijarme en los detalles de la ciudad.", { exact: true })).toBeVisible();
  await expect(page.getByText("¿Un libro de fotografía o de otra cosa?", { exact: true })).toBeVisible();
  await expect(page.locator(".conversation-message--user")).toHaveCount(2);
});

test("an unrelated pending topic is retained and stopping never starts another request", async ({ page }) => {
  await setup(page); await send(page, "Me gusta la fotografía.");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await send(page, "Además, mañana tengo una entrevista de trabajo.");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  const bodies = await requests(page);
  expect(bodies[1]?.pendingMessages?.[0]?.text).toBe("Me gusta la fotografía.");
  expect(bodies[1]?.text).toBe("Además, mañana tengo una entrevista de trabajo.");
  await emit(page, 1, ["Podemos hablar de las fotos y de esa entrevista."], false);
  await expect(page.getByText("Podemos hablar de las fotos y de esa entrevista.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect(page.getByTestId("conversation-thread").getByRole("alert")).toContainText("回复已停止");
  await page.getByRole("textbox").fill("Solo estoy escribiendo");
  await expect.poll(async () => page.evaluate(() => (window as unknown as RhythmBrowser).rhythm.cancelled.includes(1))).toBe(true);
  expect(await requests(page)).toHaveLength(2);
  await expect(page.getByText("Podemos hablar de las fotos y de esa entrevista.", { exact: true })).toBeVisible();
});

test("a broken stream retries the same full batch without duplicating user messages", async ({ page }) => {
  await setup(page); await send(page, "Me gusta la fotografía.");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  await send(page, "He comprado un libro.");
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  await page.evaluate(() => (window as unknown as RhythmBrowser).rhythm.controllers[1]!.close());
  await page.getByRole("button", { name: "重新发送" }).click();
  await expect.poll(async () => (await requests(page)).length).toBe(3);
  const bodies = await requests(page);
  expect(bodies[2]?.pendingMessages).toEqual(bodies[1]?.pendingMessages);
  expect(bodies[2]?.clientMessageId).toBe(bodies[1]?.clientMessageId);
  await emit(page, 2, ["¿Un libro de fotografía o de otra cosa?"]);
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.locator(".conversation-message--user")).toHaveCount(2);
});

test("a refreshed interrupted history waits for explicit send and recovers every pending id", async ({ page }) => {
  await setup(page, [
    { id: "previous-user", clientMessageId: "previous-client", role: "user", text: "Me gusta hacer fotos.", complete: true },
    { id: "saved-prefix", generationId: "saved-generation", role: "character", text: "Uno.\n\nDos.", complete: true, status: "cancelled" },
    { id: "later-user", clientMessageId: "later-client", role: "user", text: "He comprado un libro.", complete: true },
    { id: "proactive", role: "character", text: "Un saludo.", complete: true, sourceType: "proactive" },
  ]);
  await expect(page.getByRole("button", { name: "重新发送" })).toBeVisible();
  expect(await requests(page)).toHaveLength(0);
  await send(page, "Y otra cosa.");
  await expect.poll(async () => (await requests(page)).length).toBe(1);
  expect((await requests(page))[0]?.pendingMessages).toEqual([
    { text: "Me gusta hacer fotos.", clientMessageId: "previous-client" },
    { text: "He comprado un libro.", clientMessageId: "later-client" },
  ]);
  expect((await requests(page))[0]?.supersedes).toEqual({ generationId: "saved-generation", visibleBubbleCount: 2 });
  await emit(page, 0, ["Recibido."]);
  await expect(page.getByText("Dos.", { exact: true })).toBeVisible();
  await expect(page.locator(".conversation-message--user")).toHaveCount(3);
});

test("deleting a source immediately synchronizes dependent replies while retaining the draft", async ({ page }) => {
  const source: ConversationMessage = { id: "deletion-source", clientMessageId: "source-client", role: "user", text: "Source to delete.", complete: true };
  const unrelated: ConversationMessage = { id: "retained-reply", role: "character", text: "A retained reply.", complete: true };
  await setup(page, [source, { id: "dependent-reply", role: "character", text: "A reply removed by the server.", complete: true }, unrelated]);
  await page.route("**/api/v1/conversations/lucia/messages/deletion-source", (route) => route.fulfill({ json: { data: { deleted: true } } }));
  await page.route("**/api/v1/conversations/lucia", (route) => route.fulfill({ json: { data: { messages: [unrelated], readOnly: false, canSend: true, contactStatus: "active" } } }));
  await page.getByRole("textbox").fill("Keep this draft.");
  await page.getByText(source.text, { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("A reply removed by the server.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(unrelated.text, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("Keep this draft.");
});
