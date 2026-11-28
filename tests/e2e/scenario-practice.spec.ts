import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 390, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

test("uses one responsive workbench for the published scenario catalog", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");
  for (const title of ["餐厅沟通：点单", "餐厅沟通：打包", "校园办事：注册", "校园办事：领取", "租房沟通：费用", "租房沟通：预约", "交通沟通：买票", "邮局沟通：寄件", "酒店沟通：入住"]) {
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  }

  await page.getByRole("link", { name: /校园办事：注册与材料/ }).click();
  await expect(page.getByRole("heading", { name: "校园办事：注册与材料", exact: true })).toBeVisible();
  await expect(page.getByText(/地点、人物、价格、政策、预约和现实安排均为练习设定/u)).toBeVisible();
  await page.getByRole("link", { name: /开始实战/ }).click();
  await expect(page.getByText("Javier · 临时人物")).toBeVisible();
  await expect(page.getByPlaceholder("用西班牙语完成你的表达…")).toBeVisible();
  await expect(page.getByRole("button", { name: "按住说话" })).toHaveCount(0);
  await page.getByRole("button", { name: "切换到语音输入" }).click();
  await expect(page.getByRole("button", { name: "按住说话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换到文字输入" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("keeps the scenario detail hierarchy and primary action usable across viewports", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/explore/scenarios/scenario.campus-administration");
    await expect(page.getByRole("heading", { name: "校园办事：注册与材料" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "场景导航" })).toBeVisible();
    await expect(page.getByRole("link", { name: /开始实战/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "沟通目标" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "可用表达" })).toBeVisible();
    await expect(page.getByRole("button", { name: /朗读表达：/ })).toHaveCount(5);
    await expect(page.getByText(/目标 1 · 说明你要完成注册手续/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px overflow`).toBeLessThanOrEqual(width);
  }
});

test("keeps the practice composer usable without horizontal overflow across the release matrix", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/explore/scenarios/scenario.campus-administration/practice");
    await expect(page.getByPlaceholder("用西班牙语完成你的表达…")).toBeVisible();
    await expect(page.getByRole("button", { name: "切换到语音输入" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px overflow`).toBeLessThanOrEqual(width);
  }
});

test("keeps the common expressions panel compact and inserts a choice into the composer", async ({ page }) => {
  await authenticate(page);
  for (const width of [375, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/explore/scenarios/scenario.campus-student-card/practice");
    const toggle = page.getByRole("button", { name: "常用表达", exact: true });
    await toggle.click();
    const panel = page.getByRole("region", { name: "常用表达", exact: true });
    await expect(panel.getByRole("button", { name: "关闭常用表达" })).toBeFocused();
    const dimensions = await panel.evaluate((element) => {
      const heading = element.querySelector(".scenario-expression-drawer__heading")!.getBoundingClientRect();
      const list = element.querySelector(".scenario-expression-drawer__list")!.getBoundingClientRect();
      const panelBounds = element.getBoundingClientRect();
      const transcript = element.closest(".scenario-workbench")!.querySelector(".scenario-transcript")!.getBoundingClientRect();
      return { headingBottom: heading.bottom, listTop: list.top, listWidth: list.width, panelWidth: panelBounds.width, panelHeight: panelBounds.height, transcriptHeight: transcript.height };
    });
    expect(dimensions.listTop).toBeGreaterThanOrEqual(dimensions.headingBottom);
    expect(dimensions.listWidth).toBeGreaterThan(dimensions.panelWidth - 24);
    expect(dimensions.panelHeight).toBeLessThanOrEqual(212);
    expect(dimensions.transcriptHeight).toBeGreaterThanOrEqual(110);
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await toggle.click();
    await panel.getByRole("button", { name: /¿Puedo enviarlo por correo electrónico\?/u }).click();
    await expect(panel).toHaveCount(0);
    const composer = page.getByPlaceholder("用西班牙语完成你的表达…");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("¿Puedo enviarlo por correo electrónico?");
  }
});

test("keeps the previous turn readable when switching practice aids on a short mobile viewport", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/explore/scenarios/scenario.campus-student-card/practice");
  const hint = page.getByRole("button", { name: "提示", exact: true });
  const toggle = page.getByRole("button", { name: "常用表达", exact: true });
  const panel = page.getByRole("region", { name: "常用表达", exact: true });
  for (let level = 0; level < 3; level++) await hint.click();
  const revealedHint = page.locator(".scenario-hint").filter({ hasText: "提示 3" });
  await expect(revealedHint).toBeVisible();
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(revealedHint).toHaveCount(0);
  expect((await page.locator(".scenario-transcript").boundingBox())!.height).toBeGreaterThanOrEqual(110);
  await hint.click();
  await expect(panel).toHaveCount(0);
  await expect(revealedHint).toBeVisible();
  const composer = page.getByPlaceholder("用西班牙语完成你的表达…");
  await composer.fill("Buenos días.\n");
  await page.getByRole("button", { name: "切换到语音输入" }).click();
  await toggle.click();
  await panel.getByRole("button", { name: /¿Qué documentos tengo que presentar\?/u }).click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("Buenos días.\n¿Qué documentos tengo que presentar?");
  await expect(page.getByRole("button", { name: "按住说话" })).toHaveCount(0);
  await expect(page.locator(".scenario-turn--user")).toHaveCount(0);
});

test.describe("transcript confirmation", () => {
  test("replaces the ordinary composer while confirming a transcript on mobile", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Uses Chromium's fake microphone and permission grant.");
    await authenticate(page);
    await page.context().grantPermissions(["microphone"]);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.route("**/api/v1/transcriptions", (route) => route.fulfill({
      json: { data: { text: "Vengo a recoger mi tarjeta. ¿Qué documentos tengo que presentar?", confidence: 0.55 } },
    }));
    await page.goto("/explore/scenarios/scenario.campus-student-card/practice");
    await page.getByRole("button", { name: "提示", exact: true }).click();
    await page.getByRole("button", { name: "切换到语音输入" }).click();
    const record = page.getByRole("button", { name: "按住说话" });
    await record.focus();
    await page.keyboard.down("Space");
    await expect(page.getByRole("button", { name: "松开发送" })).toBeVisible();
    await page.keyboard.up("Space");

    const draft = page.getByRole("textbox", { name: "转写内容" });
    await expect(draft).toBeFocused();
    await expect(page.getByRole("button", { name: "按住说话" })).toHaveCount(0);
    await expect(page.locator(".scenario-hint")).toHaveCount(0);
    const dimensions = await page.locator(".scenario-transcript-confirm__heading").evaluate((heading) => {
      const [title, message] = heading.children;
      const transcript = document.querySelector(".scenario-transcript")!.getBoundingClientRect();
      return { titleBottom: title!.getBoundingClientRect().bottom, messageTop: message!.getBoundingClientRect().top, transcriptHeight: transcript.height };
    });
    expect(dimensions.messageTop).toBeGreaterThanOrEqual(dimensions.titleBottom);
    expect(dimensions.transcriptHeight).toBeGreaterThanOrEqual(110);
    await expect(page.locator(".scenario-turn--user")).toHaveCount(0);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(record).toBeFocused();
  });
});

test("keeps complete learner turns, triggers one content condition, and shows the basic review", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore/scenarios/scenario.restaurant-ordering/practice");
  const input = page.getByPlaceholder("用西班牙语完成你的表达…");
  await input.fill("Quería pedir el menú del día.");
  const firstReply = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/respond"));
  await page.getByRole("button", { name: "发送" }).click();
  const response = await firstReply;
  expect(response.status(), `回复类型：${response.headers()["content-type"]}`).toBe(200);
  expect(await response.text()).toContain('"type":"done"');
  await expect(page.getByText("Perfecto. ¿Quiere algo más?")).toBeVisible();

  await input.fill("¿Lleva frutos secos?");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你选择的菜品刚好售完，需要换一种。")).toBeVisible();
  await expect(page.getByText("你选择的菜品刚好售完，需要换一种。")).toHaveCount(1);
  await page.getByRole("button", { name: "完成练习" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "完整对话" })).toBeVisible();
  await expect(page.getByText("Quería pedir el menú del día.")).toBeVisible();
  await expect(page.getByText("¿Lleva frutos secos?")).toBeVisible();
});
