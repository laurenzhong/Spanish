import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("preserves first-edition bookmarks and teaches newly added expressions", async ({ page }) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const url = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;
  await page.context().addCookies([{ name: "spanish-e2e-user", value: userId, url }]);
  await page.addInitScript(({ key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(["connect-how-going"]));
  }, { key: `sueno:phrasebook:v1:${userId}` });
  await page.goto("/read/phrases");
  await expect(page.locator(".phrasebook-entry")).toHaveCount(120);
  const topics = page.getByRole("navigation", { name: "短语交际主题" });
  await expect(topics.getByRole("button", { name: /日常办事/u })).toHaveText(/20$/u);
  await topics.getByRole("button", { name: /我的收藏/u }).click();
  await expect(page.getByRole("button", { name: "取消收藏 ¿Qué tal te va?" })).toHaveAttribute("aria-pressed", "true");
  await topics.getByRole("button", { name: /全部表达/u }).click();
  await page.getByRole("searchbox").fill("Quería cambiar esta camiseta");
  await expect(page.locator(".phrasebook-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "怎么用", exact: true }).click();
  await expect(page.getByText(/退货可说 devolver el producto/u)).toBeVisible();
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  await expect(page.getByRole("heading", { name: /买回的裤子偏小/u })).toBeVisible();
  await page.getByRole("button", { name: "查看参考表达" }).click();
  await expect(page.getByText("Quería cambiar estos pantalones por una talla más.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "朗读参考表达" })).toBeVisible();
});

test("teaches new practical situations and keeps long social expressions usable across screen sizes", async ({ page }, testInfo) => {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}` }]);
  await page.goto("/read/phrases?search=Hay una fuga de agua debajo del fregadero");
  await expect(page.locator(".phrasebook-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "怎么用", exact: true }).click();
  await expect(page.getByText("¿Qué problema ha visto en la cocina?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "朗读对话第2句" })).toBeVisible();
  await page.getByRole("button", { name: "收藏 Hay una fuga de agua debajo del fregadero." }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "取消收藏 Hay una fuga de agua debajo del fregadero." })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "情境自测", exact: true }).click();
  await expect(page.getByRole("heading", { name: /你发现洗衣机旁边漏水/u })).toBeVisible();
  await page.getByRole("button", { name: "查看参考表达" }).click();
  await expect(page.getByText("Hay una fuga de agua al lado de la lavadora.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "朗读参考表达" })).toBeVisible();
  await page.getByRole("button", { name: "退出自测" }).click();
  await page.getByRole("searchbox").fill("Que no haya salido esta vez");
  await expect(page.locator(".phrasebook-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "怎么用", exact: true }).click();
  const evidenceDir = process.env.PHRASEBOOK_EVIDENCE_DIR ?? "test-results/phrasebook-v3";
  await mkdir(evidenceDir, { recursive: true });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
      await expect.poll(() => page.locator(".phrasebook-entry h3 button").evaluate((button) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--foreground)";
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(button).color === expected;
      }), { message: `readable title in ${theme} at ${width}px` }).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      const targets = await page.locator(".phrasebook-detail .phrasebook-speak").evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44));
      expect(targets).toBe(true);
      if ([375, 1440].includes(width)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-long-dialogue-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
      }
    }
  }
});
