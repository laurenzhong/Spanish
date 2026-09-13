import { expect, test } from "@playwright/test";

test("published article versions remain available through the shared reader route", async ({ context, page, request, baseURL }) => {
  const articleId = "article.sueno-first-cafe@1";
  const response = await request.get(`/api/v1/content/articles/${encodeURIComponent(articleId)}`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.data).toMatchObject({
    id: articleId,
    contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
  expect(payload.data.segments.length).toBeGreaterThan(0);

  await context.addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: baseURL!,
  }]);
  await page.goto(`/read/article/${encodeURIComponent(articleId)}`);
  await expect(page.getByRole("heading", { name: "Una conversación que empieza con un café" })).toBeVisible();
  await expect(page.locator("article script")).toHaveCount(0);
});
