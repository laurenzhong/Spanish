import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: e2eUserId,
      url: e2eBaseUrl,
    },
  ]);
}

test("renders one compact primary learning action with details closed", async ({ page }) => {
  await authenticate(page);
  await page.addInitScript(() => window.localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/learn");

  await expect(page.getByRole("heading", { name: "从一句真实表达开始" })).toBeVisible();
  await expect(page.getByTestId("learn-timeline")).toContainText("当前步骤");
  await expect(page.getByTestId("learn-detail-disclosure")).not.toHaveAttribute("open", "");
  await expect(page.getByText("先听一遍，抓住语气和关键信息。")).not.toBeVisible();
  await expect(page.getByTestId("learn-primary-action")).toHaveCount(1);
  await expect(page.getByText("文章库正在准备中，稍后会在这里出现。")).toHaveCount(0);
  await expect(page.getByText("每完成一句都会保存进度，随时停下也不会失去本次练习。")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("shows checkpoint details only after the returning learner asks", async ({ page }) => {
  await authenticate(page);
  await page.addInitScript((userId) => {
    window.localStorage.setItem(
      `spanish.training.checkpoint.v1:${encodeURIComponent(userId)}`,
      JSON.stringify({
        schemaVersion: 1,
        contentBundleKey: "alpha.core",
        contentBundleVersion: 1,
        contentKey: "relationship.como-se-llama",
        goalKey: "communication.relationship.ask-name",
        status: "awaiting-output",
        outputMode: "speech",
        hintLevel: 0,
        generationId: 2,
        transcript: null,
        evaluation: null,
        error: null,
      }),
    );
  }, e2eUserId);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/learn");

  await expect(page.getByRole("heading", { name: "让对话继续往前走" })).toBeVisible();
  await expect(page.getByRole("link", { name: "继续学习" })).toHaveAttribute(
    "href",
    "/learn/practice",
  );
  const details = page.getByTestId("learn-detail-disclosure");
  await expect(details).not.toHaveAttribute("open", "");
  await details.getByText("练习详情").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("录音隐私");
  await expect(page.getByTestId("learn-timeline")).toContainText("自己表达");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("keeps the learning entry usable across the viewport matrix", async ({ page }) => {
  await authenticate(page);
  await page.addInitScript(() => window.localStorage.clear());

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/learn");

    await expect(page.getByTestId("learn-focus-card")).toBeVisible();
    await expect(page.getByTestId("learn-primary-action")).toHaveCount(1);
    for (const name of ["阅读", "和 Lucía 聊聊", "探索", "练习历史"]) {
      await expect(page.locator(".learn-secondary-nav").getByRole("link", { name })).not.toHaveClass(/primary-action/);
    }
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll, `learning page overflows at ${width}px`).toBeLessThanOrEqual(
      dimensions.client + 1,
    );
  }
});
