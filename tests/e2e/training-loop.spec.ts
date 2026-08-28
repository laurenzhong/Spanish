import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const viewportWidths = [320, 375, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: "00000000-0000-4000-8000-000000000001",
      url: e2eBaseUrl,
    },
  ]);
}

test("completes a typed natural alternative and moves to the next expression", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/learn/practice");

  const loop = page.locator(".training-loop");
  await expect(loop).toHaveAttribute("data-status", "awaiting-output");
  await page.getByRole("button", { name: "用文字回答" }).click();
  await page.getByLabel("写下你的回应").fill("¿Qué tal todo?");
  await page.getByRole("button", { name: "提交文字回答" }).click();

  await expect(page.getByRole("heading", { name: "对方可以接住你的意思" })).toBeVisible();
  await page.getByRole("button", { name: "完成这句" }).click();
  await page.getByRole("button", { name: "下一句" }).click();

  await expect(page.getByRole("heading", { name: "¿Cómo se llama?" })).toBeVisible();
  await expect(loop).toHaveAttribute("data-status", "presenting-input");
});

test("shows the desktop task timeline and detail rail without horizontal overflow", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn/practice");

  await expect(page.getByTestId("training-timeline")).toContainText("听懂情境");
  await expect(page.getByTestId("training-timeline")).toContainText("自己表达");
  await expect(page.getByTestId("training-timeline")).toContainText("换一种说法");
  await expect(page.getByTestId("training-detail-rail")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(
    await page.evaluate(() => window.innerHeight),
  );
});

test("keeps the training surface accessible across the viewport matrix", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/learn/practice");

    await expect(page.getByTestId("training-timeline")).toBeVisible();
    await expect(page.getByTestId("training-detail-rail")).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll, `training surface overflows at ${width}px`).toBeLessThanOrEqual(
      dimensions.client + 1,
    );
  }
});

test("allows keyboard focus to move from output choice to the typing composer", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn/practice");

  const typingButton = page.getByRole("button", { name: "用文字回答" });
  await typingButton.focus();
  await expect(typingButton).toBeFocused();
  await typingButton.click();
  const composer = page.getByLabel("写下你的回应");
  await expect(composer).toBeVisible();
  await composer.focus();
  await composer.fill("Hola");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "提交文字回答" })).toBeFocused();
});

test("keeps the training workbench inside a narrow viewport", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn/practice");

  await expect(page.locator(".training-loop")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("keeps a voice path visible after switching to typing", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn/practice");

  await page.getByRole("button", { name: "用文字回答" }).click();
  await expect(page.getByLabel("写下你的回应")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "改用语音录音" }),
  ).toBeVisible();
});

test("restores the last stable state after a refresh", async ({ page }) => {
  await authenticate(page);
  await page.goto("/learn/practice");

  const loop = page.locator(".training-loop");
  await expect(loop).toHaveAttribute("data-status", "awaiting-output");
  await expect(loop).toHaveAttribute("data-hydrated", "true");
  await page.reload();

  await expect(loop).toHaveAttribute("data-restored", "true");
  await expect(loop).toHaveAttribute("data-status", "awaiting-output");
  await expect(page.getByText("已恢复上次稳定进度")).toBeVisible();
  await expect(page.getByText("先听一遍")).not.toBeVisible();
});

test("shows progressive hint content and a real variant prompt", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
  });
  await authenticate(page);
  await page.goto("/learn/practice");

  await page.getByRole("button", { name: "提示 1" }).click();
  await expect(page.getByTestId("training-hint-content")).toContainText("先决定");
  await page.getByRole("button", { name: "提示 2" }).click();
  await expect(page.getByTestId("training-hint-content")).toContainText("bien");
  await page.getByRole("button", { name: "提示 3" }).click();
  await expect(page.getByTestId("training-hint-content")).toContainText("句式骨架");

  await page.getByRole("button", { name: "用文字回答" }).click();
  await page.getByLabel("写下你的回应").fill("Bien, gracias.");
  await page.getByRole("button", { name: "提交文字回答" }).click();
  await expect(page.getByRole("heading", { name: "对方可以接住你的意思" })).toBeVisible();
  await page.getByRole("button", { name: "练习变式" }).click();
  await expect(page.getByRole("heading", { name: "¿Qué tal todo?" })).toBeVisible();
  await expect(page.getByText("变式情境")).toBeVisible();
  await expect(page.getByTestId("training-loop")).toHaveAttribute("data-status", "awaiting-output");
});
