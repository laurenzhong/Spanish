import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: e2eBaseUrl }]);
}

const routes = [
  ["/read", "文章"],
  ["/read/vocabulary", "词汇"],
  ["/read/phrases", "短语"],
  ["/read/corpus", "语料"],
  ["/read/saved-items", "已保存"],
] as const;

test("every route in the reading section shows the section's own navigation, exactly once", async ({ page }) => {
  await authenticate(page);

  for (const [path, label] of routes) {
    await page.goto(path);
    const navigation = page.getByRole("navigation", { name: "阅读内容类型" });
    await expect(navigation, `one navigation on ${path}`).toHaveCount(1);
    await expect(navigation, `visible on ${path}`).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: label }),
      `${label} is the current tab on ${path}`,
    ).toHaveAttribute("aria-current", "page");

    // It is the section layout's navigation, not the page's: it must be the
    // first element of the section container, with the route's own content as
    // its sibling below it. (Containment in a `main` cannot be used as the
    // discriminator — the product shell wraps the whole section in one, and the
    // pages nest their own `main` inside it.)
    const structure = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="阅读内容类型"]');
      const container = nav?.parentElement ?? null;
      return {
        containerIsSection: Boolean(container?.classList.contains("page-stack") && container.classList.contains("read-page")),
        firstChild: container?.firstElementChild === nav,
        hasContentBelow: Boolean(nav?.nextElementSibling),
      };
    });
    expect(structure, `${path} renders its own copy`).toEqual({ containerIsSection: true, firstChild: true, hasContentBelow: true });
  }
});

test("the same navigation node survives a client-side transition", async ({ page }) => {
  await authenticate(page);
  await page.goto("/read");
  const navigation = page.getByRole("navigation", { name: "阅读内容类型" });
  await expect(navigation).toBeVisible();

  // Take a reference to the node before moving. The navigation used to live
  // inside each page, so a transition replaced it — and while the destination's
  // loading state was on screen there was no navigation at all. A surviving
  // reference to the same, still-connected element is what "stays visible
  // throughout" means. (A reference, not an attribute: mutating the DOM here
  // would make React report the injected attribute as a mismatch.)
  await page.evaluate(() => {
    (window as unknown as { __readSectionNav?: Element }).__readSectionNav =
      document.querySelector('nav[aria-label="阅读内容类型"]') ?? undefined;
  });

  await navigation.getByRole("link", { name: "词汇" }).click();

  await expect(page).toHaveURL(/\/read\/vocabulary/u);
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toBeVisible();
  const kept = await page.evaluate(() => {
    const probe = (window as unknown as { __readSectionNav?: Element }).__readSectionNav;
    return {
      sameNode: Boolean(probe) && probe === document.querySelector('nav[aria-label="阅读内容类型"]'),
      stillConnected: Boolean(probe?.isConnected),
    };
  });
  expect(kept).toEqual({ sameNode: true, stillConnected: true });
  await expect(navigation.getByRole("link", { name: "词汇" })).toHaveAttribute("aria-current", "page");
});

test("the vocabulary route does not borrow the learning-position loading copy", async ({ page }) => {
  await authenticate(page);
  await page.goto("/read/vocabulary");

  // The generic `SurfaceState` loading entry is about a learning position this
  // page does not have; the route's own loading state is shelf-shaped and named
  // after the shelf (asserted in `tests/unit/read-section-layout.test.tsx`).
  await expect(page.locator("body")).not.toContainText("学习位置");
  await expect(page.locator("body")).not.toContainText("正在准备内容");
  await expect(page.getByRole("heading", { level: 1, name: "词汇" })).toHaveCount(1);
});
