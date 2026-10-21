import { expect, test, type Page } from "@playwright/test";
import { installReadAloud } from "./fixtures/read-aloud";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";

test.beforeEach(async ({ page }) => {
  await installReadAloud(page, { endAfterMs: 20 });
});

async function authenticate(page: Page) {
  await page.context().addCookies([
    { name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl },
  ]);
}

async function usePhoneViewport(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}

test("keeps the legacy phone training route usable without restoring a learning-page task CTA", async ({ page }) => {
  await authenticate(page);
  await usePhoneViewport(page);
  await page.goto("/learn");
  await expect(page.getByRole("progressbar", { name: "这组表达进度" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "开始第一次练习" })).toHaveCount(0);
  await expect(page.getByTestId("media-library")).toBeVisible();

  await page.goto("/learn/practice");
  const loop = page.getByTestId("training-loop");
  await expect(loop).toHaveAttribute("data-hydrated", "true");
  await expect(loop).toHaveAttribute("data-status", "awaiting-output");

  for (const name of ["提示", "更多提示", "最后提示"]) {
    await page.getByRole("button", { name }).click();
  }
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "用文字回答" }).click();
  await page.getByLabel("写下你的回应").fill("¿Qué tal todo?");
  await page.getByRole("button", { name: "提交文字回答" }).click();
  await expect(page.getByRole("heading", { name: "对方可以接住你的意思" })).toBeVisible();
  await page.getByRole("button", { name: "完成这句" }).click();
  await expect(page.getByText("完成一次任务不会直接改变能力画像")).toBeVisible();

  await page.goto("/me");
  await expect(page.getByTestId("profile-overview")).toBeVisible();
  await expect(page.getByText("待验证").first()).toBeVisible();
});

test("turns microphone denial into a typing path without a negative result", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    });
  });
  await authenticate(page);
  await usePhoneViewport(page);
  await page.goto("/learn/practice");
  await expect(page.getByTestId("training-loop")).toHaveAttribute("data-status", "awaiting-output");

  await page.getByRole("button", { name: "开始录音" }).click();
  await expect(page.getByRole("status")).toContainText("麦克风暂时不可用，已切换为文字回答。");
  await expect(page.getByTestId("training-loop")).toHaveAttribute("data-status", "awaiting-output");
  await expect(page.getByLabel("写下你的回应")).toBeVisible();
  await expect(page.getByText("0/3", { exact: true })).toBeVisible();
  await expect(page.getByText("没有产生负面能力记录")).not.toBeVisible();
});

test("completes content-pack listening, reading, and typing before oral verification", async ({ page }) => {
  await authenticate(page);
  await usePhoneViewport(page);
  await page.goto("/explore/packs/immersive.first-cafe-conversation");

  await page.getByRole("button", { name: "播放全文" }).click();
  await expect(page.getByText("1/6 个步骤")).toBeVisible();
  await page.getByRole("button", { name: "展开西语和中文" }).first().click();
  await expect(page.getByText("2/6 个步骤")).toBeVisible();

  const reply = page.getByRole("textbox", { name: "你的回复" });
  await reply.fill("Yo también quiero conocer gente nueva.");
  await page.getByRole("button", { name: "完成这一步" }).first().click();
  await expect(page.getByText("3/6 个步骤")).toBeVisible();
  await expect(page.getByRole("link", { name: "进入口语复核" })).toHaveAttribute("href", "/learn/practice");
});

test("retries an incomplete Lucía stream without duplicating the character message", async ({ page }) => {
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
    const messageId = "e2e-lucia-message";
    if (attempts === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: [
          JSON.stringify({ type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: body.generationId, messageId }),
          JSON.stringify({ type: "delta", generationId: body.generationId, messageId, text: "Parcial" }),
        ].join("\n") + "\n",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: body.generationId, messageId }),
        JSON.stringify({ type: "delta", generationId: body.generationId, messageId, text: "¡Hola! Qué alegría leerte." }),
        JSON.stringify({ type: "done", generationId: body.generationId, messageId }),
      ].join("\n") + "\n",
    });
  });

  await page.goto("/chat/lucia");
  const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
  await composer.fill("Hola, Lucía");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-status="failed"]')).toBeVisible();
  await expect(page.getByText("未产生任何学习评分")).toBeVisible();

  await page.getByRole("button", { name: "重新发送" }).click();
  await expect(page.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.locator(".conversation-message--character")).toHaveCount(1);
  await expect(page.locator('.conversation-message--character[data-complete="true"]')).toContainText("Qué alegría");
});
