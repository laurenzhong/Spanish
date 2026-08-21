import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: "00000000-0000-4000-8000-000000000001",
      domain: "localhost",
      path: "/",
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

test("keeps the training workbench inside a narrow viewport", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn/practice");

  await expect(page.locator(".training-loop")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
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
