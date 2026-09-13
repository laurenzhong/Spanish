import { expect, test } from "@playwright/test";

const ownerId = "00000000-0000-4000-8000-000000000001";

test("configured owner can open the content workflow while unavailable storage is explicit", async ({ context, page, baseURL }) => {
  await context.addCookies([{ name: "spanish-e2e-user", value: ownerId, url: baseURL! }]);
  await page.goto("/me/content-workflow");
  await expect(page.getByRole("heading", { name: "内容工作流" })).toBeVisible();
  await expect(page.getByText("数据库未配置或暂时不可用，候选工作流尚未读取任何数据。")).toBeVisible();
});

test("authenticated non-owner cannot open the workflow", async ({ context, page, baseURL }) => {
  await context.addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000099", url: baseURL! }]);
  await page.goto("/me/content-workflow");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "内容工作流" })).toHaveCount(0);
});
