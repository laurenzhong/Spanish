import { expect, test } from "@playwright/test";

test("renders the foundation page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "基础工程已就绪" }),
  ).toBeVisible();

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    display: "standalone",
    start_url: "/",
  });
});
