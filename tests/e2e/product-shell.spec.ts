import { expect, test, type Page } from "@playwright/test";

const e2eUserId = "00000000-0000-4000-8000-000000000001";
const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: e2eUserId,
      url: e2eBaseUrl,
    },
  ]);
}

test("shows the public introduction without requiring a session", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", {
      name: "把认识的西语，变成真正说得出口的话。",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /开始第一次练习/ }).first()).toBeVisible();
});

test("redirects anonymous product traffic to email OTP login", async ({
  page,
}) => {
  await page.goto("/learn");

  await expect(page).toHaveURL(/\/login\?next=%2Flearn$/);
  await expect(
    page.getByRole("heading", { name: "用邮箱接收验证码" }),
  ).toBeVisible();
});

test("preserves the requested page through the login handoff", async ({ page }) => {
  await page.goto("/chat/lucia");

  await expect(page).toHaveURL(/\/login\?next=%2Fchat%2Flucia$/);
  await expect(
    page.getByRole("heading", { name: "用邮箱接收验证码" }),
  ).toBeVisible();
});

test("navigates between all four product areas", async ({ page }) => {
  await authenticate(page);
  await page.goto("/learn");

  const navigation = page.getByRole("navigation", { name: "主要导航" });
  await expect(navigation.getByRole("link", { name: "学习" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  for (const destination of [
    { name: "探索", path: "/explore", heading: "校园办事：注册与材料" },
    { name: "对话", path: "/chat", heading: "Lucía Martín" },
    { name: "我的", path: "/me", heading: "我的进步" },
    { name: "学习", path: "/learn", heading: "从一句真实表达开始" },
  ]) {
    await navigation.getByRole("link", { name: destination.name }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(
      page.getByRole("heading", { name: destination.heading }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: destination.name }),
    ).toHaveAttribute("aria-current", "page");
  }

  await expect(page.getByRole("progressbar", { name: "这组表达进度" })).toHaveCount(0);
});

test("keeps the shell usable at desktop width", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn");

  const shell = page.getByTestId("product-shell");
  await expect(shell).toBeVisible();
  await expect(page.locator(".desktop-navigation")).toBeVisible();
  await expect(page.locator(".mobile-product-header").getByRole("button", { name: "打开账户菜单" })).toHaveCount(0);
  await expect(page.locator(".desktop-navigation__account").getByRole("button", { name: "打开账户菜单" })).toHaveCount(1);

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
});

test("opens the desktop account menu beside the rail without viewport clipping", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn");

  const rail = page.locator(".desktop-navigation");
  const trigger = rail.getByRole("button", { name: "打开账户菜单" });
  await trigger.click();

  const popover = page.locator(".desktop-navigation__account .account-menu__popover");
  await expect(popover).toBeVisible();
  const railBox = await rail.boundingBox();
  const popoverBox = await popover.boundingBox();
  expect(popoverBox?.x).toBeGreaterThanOrEqual((railBox?.x ?? 0) + (railBox?.width ?? 0) - 1);
  expect(popoverBox?.x).toBeLessThan(1280);
  expect((popoverBox?.x ?? 0) + (popoverBox?.width ?? 0)).toBeLessThanOrEqual(1280);
});

test("collapses the desktop rail without covering the main content", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn");
  const rail = page.locator(".desktop-navigation");
  await expect(rail.getByRole("button", { name: "收起侧边栏" })).toBeVisible();
  await rail.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(rail.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
  const collapsedBox = await rail.boundingBox();
  const contentBox = await page.locator(".product-content").boundingBox();
  expect(collapsedBox?.width).toBeGreaterThanOrEqual(68);
  expect(collapsedBox?.width).toBeLessThanOrEqual(72);
  expect(contentBox?.x).toBeGreaterThanOrEqual((collapsedBox?.x ?? 0) + (collapsedBox?.width ?? 0));
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("sueno-desktop-navigation-v1"))).toBe("collapsed");
});

test("keeps discovery and conversation entry points visible", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/explore");

  await expect(page.getByRole("searchbox", { name: "搜索场景" })).toBeVisible();
  const learnLink = page.getByRole("navigation", { name: "主要导航" }).getByRole("link", { name: "学习" });
  await expect(learnLink).toHaveAttribute("href", "/learn");
  await learnLink.click();
  await expect(page).toHaveURL(/\/learn$/);

  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" })).toBeVisible();
});

test("keeps themes and content packs out of the default scenario surface", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");

  await expect(page.getByRole("heading", { name: "校园办事：注册与材料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "沟通目标" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "内容包" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "咖啡馆里的新朋友" })).toHaveCount(0);
});

test("adds Lucía as a pinned contact only after explicit approval", async ({ page }) => {
  await authenticate(page);
  let accepted = false;
  await page.route("**/api/v1/conversations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          conversations: accepted ? [{
            conversationId: "conversation-lucia",
            characterKey: "lucia",
            characterName: "Lucía Martín",
            avatarClass: "avatar--lucia",
            roleLabel: "主要好友",
            lastMessageAt: null,
            lastMessage: null,
            isPinned: true,
          }] : [],
        },
      }),
    });
  });
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { offers: [] } }),
    });
  });
  await page.route("**/api/v1/character-network/lucia-contact", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ decision: "accept" });
      accepted = true;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          characterKey: "lucia",
          status: accepted ? "active" : "pending",
          relationshipStage: "new_contact",
          conversationId: accepted ? "conversation-lucia" : null,
          source: { kind: "cultural-event", city: "Madrid", topic: "urban-photography" },
        },
      }),
    });
  });
  await page.goto("/chat");

  await expect(page.getByRole("navigation", { name: "好友列表" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Lucía Martín.*主要好友/ })).toHaveCount(0);
  await expect(page.getByText("还没有联系人。你可以先查看新的好友申请。")).toBeVisible();
  await page.getByRole("button", { name: "查看好友申请和介绍" }).click();
  await expect(page.getByTestId("lucia-contact-request")).toBeVisible();
  await page.getByRole("button", { name: "通过申请" }).click();
  await expect(page.getByRole("link", { name: /Lucía Martín.*主要好友/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("已置顶")).toBeVisible();
});

test("shows a contextual friend introduction and requires explicit consent", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { offers: [{ offerKey: "intro-test", targetCharacterKey: "mateo", reasonCode: "shared-interest", reasonText: "你们刚好有一个共同感兴趣的话题，介绍会很自然。" }] } }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/character-network/introductions/intro-test", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ decision: "accept", memoryIds: [] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { status: "accepted", targetCharacterKey: "mateo", relationshipStage: "new_contact", conversationId: "conversation-test", sharedMemoryIds: [] } }) });
  });

  await page.goto("/chat");
  await page.getByRole("button", { name: "查看好友申请和介绍" }).click();
  await expect(page.getByRole("heading", { name: "认识一个新朋友" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mateo Ruiz" })).toBeVisible();
  await page.getByRole("button", { name: "同意介绍" }).click();
  await expect(page.locator(".conversation-introductions").getByRole("status")).toContainText("已同意介绍");
});

test("recovers the friend introduction inbox after a failed request", async ({ page }) => {
  await authenticate(page);
  let attempts = 0;
  let allowSuccess = false;
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    attempts += 1;
    if (!allowSuccess) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEMPORARY_FAILURE" } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { offers: [{ offerKey: "retry-intro", targetCharacterKey: "mateo", reasonCode: "shared-interest", reasonText: "共同兴趣" }] } }),
    });
  });

  await page.goto("/chat");
  await page.getByRole("button", { name: "查看好友申请和介绍" }).click();
  await expect(page.locator(".conversation-introductions [role=alert]")).toContainText("暂时无法读取好友介绍");
  allowSuccess = true;
  await page.getByRole("dialog", { name: "介绍请求" }).getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "Mateo Ruiz" })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test("shares only the memory explicitly selected in an introduction", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { offers: [{ offerKey: "intro-memory-test", targetCharacterKey: "mateo", reasonCode: "shared-interest", reasonText: "共同兴趣", shareableMemories: [{ id: "memory-test", category: "interest", content: "喜欢摄影", sensitivity: "normal", alreadyShared: false }] }] } }),
    });
  });
  await page.route("**/api/v1/character-network/introductions/intro-memory-test", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ decision: "accept", memoryIds: ["memory-test"] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { status: "accepted", targetCharacterKey: "mateo", relationshipStage: "new_contact", conversationId: "conversation-test", sharedMemoryIds: ["memory-test"] } }) });
  });

  await page.goto("/chat");
  await page.getByRole("button", { name: "查看好友申请和介绍" }).click();
  const memory = page.getByRole("checkbox", { name: /喜欢摄影/ });
  await expect(memory).not.toBeChecked();
  await memory.check();
  await page.getByRole("button", { name: "同意介绍" }).click();
  await expect(page.locator(".conversation-introductions").getByRole("status")).toContainText("已同意介绍");
});

test("lets the user revoke a target-specific memory permission", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/character-network/permissions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { permissions: [{ id: "memory-revoke-test", characterKey: "lucia", targetCharacterKey: "mateo", category: "interest", content: "喜欢摄影", sensitivity: "normal", alreadyShared: true }] } }),
    });
  });
  await page.route("**/api/v1/character-network/permissions/memory-revoke-test/mateo", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { revoked: true } }) });
  });

  await page.goto("/me#profile-relationships");
  await expect(page.getByRole("heading", { name: "已授权给角色的资料" })).toBeVisible();
  const revokeButton = page.getByRole("button", { name: "撤销授权" });
  await revokeButton.scrollIntoViewIfNeeded();
  await revokeButton.click({ force: true });
  await expect(page.getByRole("status")).toContainText("已撤销");
});

test("lets the user delete an owned relationship memory", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/profile/memories**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { memories: [{ id: "00000000-0000-4000-8000-000000000071", characterKey: "lucia", category: "interest", content: "喜欢摄影", createdAt: "2026-08-25T00:00:00.000Z", sensitivity: "normal", shareScope: "private", status: "candidate" }] } }),
      });
      return;
    }
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().url()).toContain("memoryId=00000000-0000-4000-8000-000000000071");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { deleted: true } }) });
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/me#profile-relationships");
  await expect(page.getByRole("heading", { name: "我的关系记忆" })).toBeVisible();
  await expect(page.getByText("喜欢摄影")).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "删除记忆" });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click({ force: true });
  await expect(page.getByTestId("memory-data-controls").getByRole("status")).toContainText("已删除");
  await expect(page.getByText("喜欢摄影")).not.toBeVisible();
});

test("lets the user delete a saved speech transcript", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/profile/media**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { audio: [], transcripts: [{ attemptId: "00000000-0000-4000-8000-000000000072", createdAt: "2026-08-25T00:00:00.000Z", text: "¿Cómo va todo?" }] } }),
      });
      return;
    }
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().url()).toContain("kind=transcript");
    expect(route.request().url()).toContain("id=00000000-0000-4000-8000-000000000072");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { deleted: true, kind: "transcript", id: "00000000-0000-4000-8000-000000000072" } }) });
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/me#profile-data");
  await expect(page.getByRole("heading", { name: "已保存的录音与转写" })).toBeVisible();
  await expect(page.getByText("¿Cómo va todo?")).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "删除转写" });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click({ force: true });
  await expect(page.getByTestId("voice-data-controls").getByRole("status")).toContainText("已删除");
  await expect(page.getByText("¿Cómo va todo?")).not.toBeVisible();
});

test("requires explicit confirmation before deleting account data", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/me/data", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { sessions: 2, practiceAttempts: 3, evidenceEvents: 2, conversations: 1, relationshipMemories: 1, savedAudio: 1, savedTranscripts: 1 } }),
      });
      return;
    }
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({ confirmation: "DELETE_MY_DATA" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { alreadyDeleted: false, cleanupDeferred: 0, evidenceDeleted: 2, providerCallsAnonymized: 1 } }),
    });
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/me#profile-data");
  await expect(page.getByRole("heading", { name: "删除我的账号数据" })).toBeVisible();
  const deleteAccountButton = page.getByRole("button", { name: "删除账号数据" });
  await deleteAccountButton.scrollIntoViewIfNeeded();
  await deleteAccountButton.click({ force: true });
  await expect(page.getByTestId("account-data-controls").getByRole("status")).toHaveText("账号数据已删除。");
});

test("preserves the selected discovery direction on the learning page", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/explore");

  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.getByRole("searchbox").fill("que documentos");
  await expect(page.getByRole("heading", { name: "校园办事：注册与材料" })).toBeVisible();
  await expect(page.getByText("没有匹配的场景")).toHaveCount(0);

  await page.goto("/learn?focus=needs");
  await expect(page).toHaveURL(/\/learn\?focus=needs$/);
  await expect(page.locator(".focus-card")).toHaveAttribute("data-focus", "needs");
});

test("opens the published reading shelf and article reader", async ({ page }) => {
  await authenticate(page);
  const wideDesktop = (page.viewportSize()?.width ?? 0) >= 1200;
  let savedArticleId: string | null = null;
  await page.route("**/api/v1/read/saved", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { articleIds: savedArticleId ? [savedArticleId] : [] } }) });
      return;
    }
    const body = route.request().postDataJSON() as { articleId?: string; saved?: boolean };
    savedArticleId = body.saved ? body.articleId ?? null : null;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { articleId: body.articleId, saved: Boolean(savedArticleId) } }) });
  });
  await page.goto("/read");

  await expect(page).toHaveTitle(/阅读/);
  await expect(page.getByRole("link", { name: "回到今天" })).toHaveCount(0);
  await expect(page.getByText("安静输入", { exact: true })).toHaveCount(0);
  await expect(page.getByText("读一篇真实的西语文章", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "公共文章" })).toBeVisible();
  await expect(page.getByRole("link", { name: "我的文章" })).toHaveAttribute("href", "/read?saved=1");
  await expect(page.getByRole("link", { name: "Web Sites" })).toHaveCount(0);
  await expect(page.getByText("105 篇", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "文章分页" })).toBeVisible();
  await expect(page.getByLabel("第 1 页，当前页")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/read?page=2");
  await page.getByRole("link", { name: "下一页" }).click();
  await expect(page).toHaveURL(/\/read\?page=2$/);
  await expect(page.locator("article.read-article-row")).toHaveCount(12);
  await expect(page.getByLabel("第 2 页，当前页")).toHaveAttribute("aria-current", "page");
  await page.locator("summary").filter({ hasText: "添加内容" }).click();
  await expect(page.getByRole("link", { name: "生成私人故事" })).toHaveAttribute("href", "/read/generate");
  await page.locator("summary").filter({ hasText: "筛选" }).click();
  await expect(page.locator(".read-add-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator(".read-filter-menu__panel")).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索文章" }).click();
  await expect(page.locator(".read-filter-menu")).not.toHaveAttribute("open", "");
  await page.goto("/read");
  const firstArticleLink = page.getByRole("link", { name: "Una conversación que empieza con un café", exact: true });
  await expect(firstArticleLink).toBeVisible();
  await expect(firstArticleLink).toHaveCSS("white-space", "nowrap");
  await expect(firstArticleLink).toHaveCSS("text-overflow", "ellipsis");
  const firstArticleRow = page.locator("article.read-article-row").first();
  await page.evaluate(() => document.fonts?.ready);
  await firstArticleRow.evaluate(async (element) => {
    const pageStack = element.closest(".page-stack");
    await Promise.all(pageStack?.getAnimations().map((animation) => animation.finished.catch(() => undefined)) ?? []);
  });
  const firstArticleTop = await firstArticleRow.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const firstArticleSave = page.getByRole("button", { name: /收藏文章：Una conversación que empieza con un café/ });
  await firstArticleSave.click();
  await page.evaluate(() => document.fonts?.ready);
  const firstArticleTopAfterSave = await firstArticleRow.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  expect(Math.abs(firstArticleTopAfterSave - firstArticleTop)).toBeLessThan(5);
  await expect(page.getByRole("button", { name: /取消收藏：Una conversación que empieza con un café/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("已收藏。");
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 4000 });
  await firstArticleLink.click();
  await expect(page).toHaveURL(/\/read\/article\/article\.sueno-first-cafe%401$/);
  await expect(page.getByRole("heading", { name: "Una conversación que empieza con un café" })).toBeVisible();
  await expect(page.getByTestId("article-transfer")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "文章个人笔记" })).toHaveCount(0);
  await page.getByRole("button", { name: "收藏" }).click();
  await expect(page.getByRole("textbox", { name: "文章个人笔记" })).toBeVisible();
  if (wideDesktop) await page.getByRole("heading", { name: "Una conversación que empieza con un café" }).click();
  else await page.locator(".article-reader__scrim").click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("textbox", { name: "文章个人笔记" })).toHaveCount(0);
  await page.getByText("读完后练口语", { exact: true }).click();
  await expect(page.getByTestId("article-transfer")).toBeVisible();
  await page.goto("/read");
  await page.getByRole("link", { name: "我的文章" }).click();
  await expect(page).toHaveURL(/\/read\?saved=1$/);
  await expect(page.getByRole("link", { name: "Una conversación que empieza con un café", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /取消收藏：Una conversación que empieza con un café/ }).click();
  await expect(page.getByRole("heading", { name: "还没有收藏文章" })).toBeVisible();
});

test("redirects readers to login when their save session expires", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/read/saved", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { articleIds: [] } }) });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", error: { code: "AUTH_REQUIRED" } }) });
  });
  await page.goto("/read");
  const title = "Una conversación que empieza con un café";
  await page.context().clearCookies();
  await page.getByRole("button", { name: `收藏文章：${title}` }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fread$/);
});

test("keeps the profile axes visible and selectable", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/me");

  const overview = page.getByTestId("profile-overview");
  await expect(overview).toBeVisible();
  await expect(
    overview.locator(".profile-axis-list").getByRole("button", { name: /迁移表达/ }),
  ).toBeVisible();

  await overview
    .locator(".profile-axis-list")
    .getByRole("button", { name: /迁移表达/ })
    .click();
  await expect(
    overview.getByRole("heading", { name: "迁移表达" }),
  ).toBeVisible();

  const heatmap = page.getByTestId("learning-heatmap");
  await expect(heatmap).toBeVisible();
  const visibleDay = heatmap.locator("[data-date]").first();
  await visibleDay.click();
  await expect(heatmap.getByTestId("heatmap-day-detail")).toBeVisible();
});

test("shows provider settings and keeps them usable across the release viewport matrix", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/providers/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { capabilities: [{ capability: "scenario-roleplay", selectedProviderKey: null, selectedProviderAvailable: true, effectiveProviderKey: "minimax", canAutoSwitch: true, providers: [{ key: "minimax", label: "MiniMax", configured: true, status: "healthy", lastSuccessAt: "2026-09-12T07:00:00.000Z", lastFailureAt: null }, { key: "openai", label: "OpenAI", configured: true, status: "configured", lastSuccessAt: null, lastFailureAt: null }] }] } }) });
  });
  await page.route("**/api/v1/me/provider-preferences", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiVersion: "v1", data: { preference: { capability: "scenario-roleplay", providerKey: "openai" } } }) });
  });
  for (const width of [320, 375, 390, 414, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/me#preferences");
    await expect(page.getByRole("region", { name: "Provider 设置" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "临时人物回复 Provider" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px overflow`).toBeLessThanOrEqual(width);
  }
  await page.getByRole("combobox", { name: "临时人物回复 Provider" }).selectOption("openai");
  await expect(page.getByText("临时人物回复设置已保存。")).toBeAttached();
});

test("returns the authenticated session through the versioned API", async ({
  page,
}) => {
  await authenticate(page);

  const response = await page.request.get("/api/v1/auth/session");
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({
    apiVersion: "v1",
    data: { userId: e2eUserId, email: "e2e@example.test" },
  });
});
