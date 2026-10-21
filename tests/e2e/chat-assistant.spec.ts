import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installReadAloud } from "./fixtures/read-aloud";

// The released character revision is read from the authored source without an
// ESM JSON import: this package is `type: module`, and the Playwright loader
// (Node 24) rejects JSON modules that lack an import attribute. The existing
// chat-expression-assist.spec.ts still imports the catalog module directly and
// currently fails to load for that reason before any test runs.
const luciaBible = JSON.parse(readFileSync(new URL("../../content/characters/lucia.json", import.meta.url), "utf8")) as {
  version: number;
};
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const characterVersion = luciaBible.version;

const answer = "这两句都能拒绝邀请，同时给出替代时间。第一句更委婉，第二句更直接。";
const suggestions = [
  {
    spanish: "No es que no quiera ir, es que hoy estoy un poco cansado. ¿Quedamos otro día?",
    chinese: "不是不想去，只是今天有点累。改天再约好吗？",
  },
  {
    spanish: "Me encantaría, pero hoy necesito descansar. ¿Te parece mañana?",
    chinese: "我很想去，但今天需要休息。明天可以吗？",
  },
];

type AssistantRequest = Readonly<{
  intent: string;
  characterVersion: number;
  attemptId: string;
  question?: string;
  targetText?: string;
}>;
type StreamRequest = Readonly<{ text: string; generationId: string; assistance?: string }>;

async function authenticate(page: Page, baseURL: string) {
  const streams: StreamRequest[] = [];
  const assistantRequests: AssistantRequest[] = [];
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: baseURL }]);
  // No unexpected browser API request may reach a real provider or database.
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { error: { code: "e2e-unmocked-api" } } }));
  await page.route("**/api/v1/conversations", (route) => route.fulfill({ json: { data: { conversations: [] } } }));
  await page.route("**/api/v1/character-network/lucia-contact", (route) => route.fulfill({ json: { data: {
    characterKey: "lucia", status: "active", relationshipStage: "familiar", conversationId: "conversation-lucia",
  } } }));
  await page.route("**/api/v1/character-network/introductions", (route) => route.fulfill({ json: { data: { offers: [] } } }));
  await page.route("**/api/v1/conversations/lucia", (route) => route.fulfill({ json: { data: { characterKey: "lucia", messages: [] } } }));
  await page.route("**/api/v1/conversations/lucia/assistant", async (route) => {
    const request = route.request().postDataJSON() as AssistantRequest;
    assistantRequests.push(request);
    await route.fulfill({ json: { apiVersion: "v1", data: {
      attemptId: request.attemptId,
      intent: request.intent,
      answer,
      suggestions,
      corrections: [],
      structure: [],
      correctedSentence: null,
    } } });
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
  return { streams, assistantRequests };
}

test("applies an AI reply suggestion and only sends it after explicit confirmation", async ({ page, baseURL }) => {
  const { streams, assistantRequests } = await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");

  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true });
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("");

  await page.getByRole("button", { name: "更多对话操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "AI 助手", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Lucía Martín 的 AI 助手", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("menu", { name: "对话操作", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "向 AI 助手提问", exact: true })).toBeFocused();

  await dialog.getByRole("button", { name: "帮我回复", exact: true }).click();
  await expect(dialog.getByText(suggestions[0].spanish, { exact: true })).toBeVisible();
  await expect(dialog.getByText(answer, { exact: true })).toBeVisible();
  expect(assistantRequests).toHaveLength(1);
  expect(Object.keys(assistantRequests[0] ?? {}).sort()).toEqual(["attemptId", "characterVersion", "intent"]);
  expect(assistantRequests[0]).toMatchObject({ intent: "reply", characterVersion, attemptId: expect.any(String) });

  // The assistant call is not a chat turn: it produces no message and never
  // touches the stream endpoint.
  await expect(page.locator(".conversation-message")).toHaveCount(0);
  expect(streams).toHaveLength(0);

  // Reading a suggestion uses the shared authenticated TTS voice, not the
  // browser speech engine.
  await dialog.getByRole("button", { name: "朗读这条建议", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "readAloudTrace"))).toEqual([{ text: suggestions[0].spanish, lang: "es-ES" }]);
  await expect(dialog.getByRole("button", { name: "停止朗读这条建议", exact: true }).first()).toBeVisible();

  await dialog.getByRole("button", { name: "填入输入框", exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveValue(suggestions[0].spanish);
  await expect(composer).toBeFocused();
  await expect(page.locator(".conversation-message")).toHaveCount(0);
  expect(streams).toHaveLength(0);

  // Only the learner's explicit send creates the chat turn.
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => streams.length).toBe(1);
  expect(streams[0]).toMatchObject({ text: suggestions[0].spanish });
  expect(streams[0]).not.toHaveProperty("assistance");
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.locator(".conversation-message--user")).toHaveCount(1);
  expect(assistantRequests).toHaveLength(1);
  // The assistant answer itself never becomes a chat message.
  await expect(page.getByText(answer, { exact: true })).toHaveCount(0);
  await expect(page.locator(".conversation-message")).toHaveCount(2);
});

test("keeps the transcript during a reopen and closes on Escape without sending", async ({ page, baseURL }) => {
  const { streams, assistantRequests } = await authenticate(page, baseURL!);
  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话", exact: true });

  await page.getByRole("button", { name: "更多对话操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "AI 助手", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Lucía Martín 的 AI 助手", exact: true });
  await dialog.getByRole("button", { name: "帮我回复", exact: true }).click();
  await expect(dialog.getByText(suggestions[0].spanish, { exact: true })).toBeVisible();
  expect(assistantRequests).toHaveLength(1);

  await dialog.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveValue("");
  expect(streams).toHaveLength(0);

  await page.getByRole("button", { name: "更多对话操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "AI 助手", exact: true }).click();
  await expect(dialog.getByText(suggestions[0].spanish, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更多对话操作", exact: true })).toBeFocused();
  expect(assistantRequests).toHaveLength(1);
  expect(streams).toHaveLength(0);
});
