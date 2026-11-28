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
  const publicNavigation = page.getByRole("navigation", { name: "公开页面导航" });
  // Secondary navigation is visible on wider screens.
  if ((page.viewportSize()?.width ?? 0) > 620) {
    await expect(publicNavigation.getByRole("link", { name: "产品方式" })).toHaveAttribute("href", "#how-it-works");
    await expect(publicNavigation.getByRole("link", { name: "阅读" })).toHaveAttribute("href", "/login?next=%2Fread");
  } else {
    await expect(publicNavigation).toBeHidden();
  }
  await expect(page.getByRole("link", { name: "进入学习", exact: true })).toHaveAttribute("href", "/learn");
});

test("redirects anonymous product traffic to email OTP login", async ({
  page,
}) => {
  await page.goto("/learn");

  await expect(page).toHaveURL(/\/login\?next=%2Flearn$/);
  await expect(
    page.getByRole("heading", { name: "¡Bienvenido!" }),
  ).toBeVisible();
});

test("preserves the requested page through the login handoff", async ({ page }) => {
  await page.goto("/chat/lucia");

  await expect(page).toHaveURL(/\/login\?next=%2Fchat%2Flucia$/);
  await expect(
    page.getByRole("heading", { name: "¡Bienvenido!" }),
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
    { name: "学习", path: "/learn", testId: "media-library" },
  ]) {
    await navigation.getByRole("link", { name: destination.name }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    if ("testId" in destination) {
      await expect(page.getByTestId(destination.testId!)).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: destination.heading! })).toBeVisible();
    }
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

test("keeps the desktop rail beside the content without covering it", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/learn");

  // The collapsible-rail control was removed with the landing/UI refresh, so this
  // asserts the rail's actual invariant: a fixed icon rail whose right edge is
  // the content's left edge, with the account menu still reachable.
  const rail = page.locator(".desktop-navigation");
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button", { name: "打开账户菜单" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "学习", exact: true })).toBeVisible();

  const railBox = await rail.boundingBox();
  const contentBox = await page.locator(".product-content").boundingBox();
  expect(railBox?.width ?? 0).toBeGreaterThanOrEqual(80);
  expect(railBox?.width ?? 0).toBeLessThanOrEqual(96);
  expect(Math.abs((contentBox?.x ?? 0) - (railBox?.x ?? 0) - (railBox?.width ?? 0))).toBeLessThanOrEqual(2);
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

test("adds Lucía as a pinned contact only after explicit approval", async ({ page, isMobile }) => {
  await authenticate(page);
  const decisions: string[] = [];
  let status: "pending" | "declined" | "active" = "pending";
  await page.route("**/api/v1/conversations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          conversations: status === "active" ? [{
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
      const { decision } = route.request().postDataJSON();
      expect(decision).toBe(status === "pending" ? "decline" : "accept");
      decisions.push(decision);
      status = decision === "accept" ? "active" : "declined";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          characterKey: "lucia",
          status,
          relationshipStage: "new_contact",
          conversationId: status === "active" ? "conversation-lucia" : null,
          source: { kind: "cultural-event", city: "Madrid", topic: "urban-photography" },
        },
      }),
    });
  });
  await page.goto("/chat");

  await expect(page.getByRole("navigation", { name: "好友列表" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Lucía Martín.*主要好友/ })).toHaveCount(0);
  await expect(page.getByText("还没有联系人。你可以先查看新的好友申请。")).toBeVisible();
  const open = page.getByRole("button", { name: /待处理/ });
  if (isMobile) await open.tap();
  else await open.click();
  await expect(page.getByTestId("lucia-contact-request")).toBeVisible();
  const luciaContact = page.getByRole("link", { name: /Lucía Martín.*主要好友/ });
  const inbox = page.getByRole("dialog", { name: "好友申请与介绍" });
  const close = inbox.getByRole("button", { name: "关闭好友申请与介绍" });
  const decline = inbox.getByRole("button", { name: "暂不接受" });
  if (isMobile) await decline.tap();
  else await decline.click();
  await expect(inbox.getByRole("status")).toContainText("已暂不接受");
  await close.click();
  await expect(luciaContact).toHaveCount(0);
  await expect(open).toHaveCount(0);
  const reconsider = page.getByRole("button", { name: "好友申请与介绍", exact: true });
  if (isMobile) await reconsider.tap({ timeout: 5000 });
  else await reconsider.click({ timeout: 5000 });
  await expect(inbox.getByText("你仍可以通过这项申请。", { exact: false })).toBeVisible();
  const approve = inbox.getByRole("button", { name: "通过申请" });
  if (isMobile) await approve.tap();
  else await approve.click();
  await expect(inbox.getByRole("status")).toContainText("已通过 Lucía 的好友申请");
  await close.click();
  await expect(luciaContact).toHaveAttribute("href", "/chat/lucia");
  await expect(page.getByRole("heading", { name: "对话", exact: true })).toBeFocused();
  expect(decisions).toEqual(["decline", "accept"]);
  if (isMobile) {
    await luciaContact.tap();
    await expect(page).toHaveURL(/\/chat\/lucia$/u);
    return;
  }
  await luciaContact.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "取消置顶" })).toBeVisible();
});

test("requires explicit consent and refreshes the new contact without reloading", async ({ page, isMobile }) => {
  await authenticate(page);
  let accepted = false;
  let responses = 0;
  await page.route("**/api/v1/conversations", (route) => route.fulfill({ json: { data: { conversations: accepted ? [{
    conversationId: "conversation-test", characterKey: "mateo", characterName: "Mateo Ruiz", avatarClass: "avatar--mateo",
    roleLabel: "好友", lastMessageAt: null, lastMessage: null,
  }] : [] } } }));
  await page.route("**/api/v1/character-network/lucia-contact", (route) => route.fulfill({ json: { data: { status: "active" } } }));
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { offers: accepted ? [] : [{ offerKey: "intro-test", targetCharacterKey: "mateo", reasonCode: "shared-interest", reasonText: "你们刚好有一个共同感兴趣的话题，介绍会很自然。" }] } }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/character-network/introductions/intro-test", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ decision: "accept", memoryIds: [] });
    responses += 1;
    accepted = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { status: "accepted", targetCharacterKey: "mateo", relationshipStage: "new_contact", conversationId: "conversation-test", sharedMemoryIds: [] } }) });
  });

  await page.goto("/chat");
  const open = page.getByRole("button", { name: /待处理/ });
  const mateo = page.getByRole("navigation", { name: "好友列表" }).getByRole("link", { name: /Mateo Ruiz/ });
  await expect(mateo).toHaveCount(0);
  if (isMobile) await open.tap();
  else await open.click();
  await expect(page.getByRole("heading", { name: "认识一个新朋友" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mateo Ruiz" })).toBeVisible();
  expect(responses).toBe(0);
  const accept = page.getByRole("button", { name: "同意介绍" });
  if (isMobile) await accept.tap();
  else await accept.click();
  await expect(page.locator(".conversation-introductions").getByRole("status")).toContainText("已同意介绍");
  await page.getByRole("button", { name: "关闭好友申请与介绍" }).click();
  await expect(mateo).toHaveAttribute("href", "/chat/mateo");
  expect(responses).toBe(1);
});

test("opens and recovers the friend introduction inbox after the initial read fails", async ({ page, isMobile }) => {
  await authenticate(page);
  let attempts = 0;
  let allowSuccess = false;
  await page.route("**/api/v1/character-network/lucia-contact", (route) => route.fulfill({ json: { data: { status: "active" } } }));
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
  await expect.poll(() => attempts).toBeGreaterThanOrEqual(1);
  const open = page.getByRole("button", { name: "好友申请与介绍", exact: true });
  if (isMobile) await open.tap({ timeout: 5000 });
  else await open.click({ timeout: 5000 });
  await expect(page.locator(".conversation-introductions [role=alert]")).toContainText("暂时无法读取好友介绍");
  await expect(page.getByText("目前没有新的介绍请求。")).toHaveCount(0);
  allowSuccess = true;
  const retry = page.getByRole("dialog", { name: "好友申请与介绍" }).getByRole("button", { name: "重试" });
  if (isMobile) await retry.tap();
  else await retry.click();
  await expect(page.getByRole("heading", { name: "Mateo Ruiz" })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(3);
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
  await page.getByRole("button", { name: /待处理/ }).click();
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
  await page.goto("/me#profile-relationships");
  await expect(page.getByRole("heading", { name: "我的关系记忆" })).toBeVisible();
  await expect(page.getByText("喜欢摄影")).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "删除记忆" });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click();
  await page.getByRole("alertdialog", { name: "删除这条关系记忆？" }).getByRole("button", { name: "确认删除记忆" }).click();
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
  await page.goto("/me#profile-data");
  await expect(page.getByRole("heading", { name: "已保存的录音与转写" })).toBeVisible();
  await expect(page.getByText("¿Cómo va todo?")).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "删除转写" });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click();
  await page.getByRole("alertdialog", { name: "删除这条转写？" }).getByRole("button", { name: "确认删除转写" }).click();
  await expect(page.getByTestId("voice-data-controls").getByRole("status")).toContainText("已删除");
  await expect(page.getByText("¿Cómo va todo?")).not.toBeVisible();
});

test("requires explicit confirmation before deleting account data", async ({ page }) => {
  await authenticate(page);
  let deleteRequests = 0;
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
    deleteRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { alreadyDeleted: false, cleanupDeferred: 0, evidenceDeleted: 2, providerCallsAnonymized: 1 } }),
    });
  });
  await page.goto("/me#profile-data");
  await expect(page.getByRole("heading", { name: "删除我的账号数据" })).toBeVisible();
  const deleteAccountButton = page.getByRole("button", { name: "删除账号数据" });
  await deleteAccountButton.scrollIntoViewIfNeeded();
  await deleteAccountButton.click();
  const confirmation = page.getByRole("alertdialog", { name: "删除我的账号数据？" });
  await expect(confirmation).toBeVisible();
  expect(deleteRequests).toBe(0);
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(confirmation).toHaveCount(0);
  expect(deleteRequests).toBe(0);
  await deleteAccountButton.click();
  await confirmation.getByRole("button", { name: "确认删除账号数据" }).click();
  await expect(page.getByTestId("account-data-controls").getByRole("status")).toHaveText("账号数据已删除。");
  expect(deleteRequests).toBe(1);
});

test("keeps legacy learning query state from restoring the former task card", async ({
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
  await expect(page.getByTestId("media-library")).toBeVisible();
  await expect(page.locator(".focus-card")).toHaveCount(0);
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
  const readingNavigation = page.getByRole("navigation", { name: "阅读内容类型" });
  await expect(readingNavigation).toBeVisible();
  await expect(readingNavigation.getByRole("link")).toHaveText(["文章", "词汇", "短语", "语料", "已保存"]);
  await expect(readingNavigation.getByRole("link", { name: "文章" })).toHaveAttribute("aria-current", "page");
  // Regression guard: the sliding underline marks the current page, so the
  // search box must neither sit flush against it nor be reintroduced behind a
  // section rule.
  const underlinedTab = page.locator('.read-section-navigation a[aria-current="page"]');
  const searchFieldBox = await page.locator(".read-search__field").boundingBox();
  const underlinedTabBox = await underlinedTab.boundingBox();
  expect(searchFieldBox).not.toBeNull();
  expect(underlinedTabBox).not.toBeNull();
  expect((searchFieldBox?.y ?? 0) - ((underlinedTabBox?.y ?? 0) + (underlinedTabBox?.height ?? 0))).toBeGreaterThanOrEqual(9);
  // No section rule may be reintroduced above the search field.
  const sectionRuleBorders = await page.evaluate(() =>
    [".read-section-navigation", ".read-library__toolbar"].map((selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).borderBottomWidth : "missing";
    }),
  );
  expect(sectionRuleBorders).toEqual(["0px", "0px"]);
  // The single accent underline is a transform-driven element: it settles on the
  // current page, follows the pointer while it is inside the navigation, and
  // returns to the current page when the pointer leaves.
  const navigationIndicator = page.locator(".read-section-navigation__indicator");
  const vocabularyTab = readingNavigation.getByRole("link", { name: "词汇" });
  await expect(readingNavigation).toHaveAttribute("data-indicator", "ready");
  await expect(navigationIndicator).toHaveCSS("opacity", "1");
  const indicatorBox = await navigationIndicator.boundingBox();
  const indicatorViewport = page.viewportSize() ?? { width: 0, height: 0 };
  expect(indicatorBox).not.toBeNull();
  expect(indicatorBox?.width ?? 0).toBeGreaterThan(0);
  expect(indicatorBox?.width ?? 0).toBeLessThan(indicatorViewport.width);
  // The indicator is measured against the navigation's own left edge, so compare
  // the rendered translate with the tab's offset inside the navigation.
  const vocabularyTabOffset = await vocabularyTab.evaluate((element) => {
    const link = element.getBoundingClientRect();
    const navigation = element.closest(".read-section-navigation");
    if (!navigation) return null;
    return link.left - navigation.getBoundingClientRect().left + navigation.scrollLeft;
  });
  const activeTabOffset = await underlinedTab.evaluate((element) => {
    const link = element.getBoundingClientRect();
    const navigation = element.closest(".read-section-navigation");
    if (!navigation) return null;
    return link.left - navigation.getBoundingClientRect().left + navigation.scrollLeft;
  });
  expect(vocabularyTabOffset).not.toBeNull();
  const translateX = async () => Number(/matrix\(1, 0, 0, 1, (-?[\d.]+), 0\)/u.exec(await navigationIndicator.evaluate((element) => getComputedStyle(element).transform))?.[1] ?? Number.NaN);

  await vocabularyTab.hover();
  await expect.poll(translateX).toBeCloseTo(vocabularyTabOffset ?? 0, 1);
  const navigationBox = await readingNavigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  await page.mouse.move(4, (navigationBox?.y ?? 0) + (navigationBox?.height ?? 0) + 40);
  await expect.poll(translateX).toBeCloseTo(activeTabOffset ?? 0, 1);
  // The public shelf already is `文章` in the navigation above, so the personal
  // entry must stay the only secondary tab.
  await expect(page.getByRole("link", { name: "公共文章" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "我的文章" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Web Sites" })).toHaveCount(0);
  // The shelf dropped its "N 篇" counter when it became the public-only list;
  // the first page of the paginated article list is the honest equivalent.
  await expect(page.locator("article.read-article-row")).toHaveCount(12);
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
  // The public shelf keeps the save star; unsaving must be reflected there.
  await page.goto("/read");
  await page.getByRole("button", { name: /取消收藏：Una conversación que empieza con un café/u }).click();
  await expect(page.getByRole("status")).toContainText("已取消收藏。");
  await expect(page.getByRole("button", { name: /收藏文章：Una conversación que empieza con un café/u })).toBeVisible();
  // The personal shelf is the only entry point for saved articles now. The e2e
  // server has no DATABASE_URL, so the shelf must report itself rather than
  // render rows it cannot read.
  await page.goto("/read/saved-items?itemType=article");
  const shelfNavigation = page.getByRole("navigation", { name: "已保存内容类型" });
  await expect(shelfNavigation.getByRole("link", { name: "文章" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".saved-item-card")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "已保存内容暂时不可用" })).toBeVisible();
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

test("keeps the profile empty state focused before evidence exists", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/me");

  const overview = page.getByTestId("profile-overview");
  await expect(overview).toBeVisible();
  // PROFILE-001 replaced the old eight-dimension empty state with the four-block
  // summary plus the radar outline, so the empty profile is asserted as the
  // first-step headline with zero verified axes and no primary action yet.
  await expect(overview.getByRole("heading", { name: "完成第一次口语练习，开始积累真实证据" })).toBeVisible();
  const summary = overview.getByLabel("能力总览摘要");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("已验证维度")).toBeVisible();
  await expect(summary.getByRole("link", { name: /继续练习/ })).toHaveCount(0);
  await expect(overview.getByLabel("八维能力选择")).toBeVisible();

  const heatmap = page.getByTestId("learning-heatmap");
  await expect(heatmap).toBeVisible();
  await expect(heatmap.getByTestId("learning-heatmap-empty")).toBeVisible();
  await expect(heatmap.locator("[data-date]")).toHaveCount(0);

  // The section navigation shares the one sliding underline: it rests on the
  // active section and moves with the pointer without leaving a static
  // underline behind on the first item.
  const sectionNavigation = page.getByRole("navigation", { name: "我的页面分区" });
  const sectionIndicator = page.locator(".profile-page__section-nav-indicator");
  await expect(sectionNavigation).toHaveAttribute("data-indicator", "ready");
  await expect(sectionIndicator).toHaveCSS("opacity", "1");
  const sectionIndicatorBox = await sectionIndicator.boundingBox();
  const activeSectionBox = await sectionNavigation.getByRole("link", { name: "能力与活动" }).boundingBox();
  expect(sectionIndicatorBox).not.toBeNull();
  expect(activeSectionBox).not.toBeNull();
  expect(Math.abs((sectionIndicatorBox?.x ?? 0) - (activeSectionBox?.x ?? 0))).toBeLessThan(1);
  // The width is read while the 240ms transform/width transition settles, so a
  // sub-pixel difference is expected; anything wider would mean a mis-measure.
  expect(Math.abs((sectionIndicatorBox?.width ?? 0) - (activeSectionBox?.width ?? 0))).toBeLessThan(2);
  const relationshipsTab = sectionNavigation.getByRole("link", { name: "关系隐私" });
  await relationshipsTab.hover();
  await expect.poll(async () => (await sectionIndicator.boundingBox())?.x ?? 0).toBeGreaterThan((sectionIndicatorBox?.x ?? 0) + 10);
  await relationshipsTab.click();
  await expect(page).toHaveURL(/#profile-relationships$/);
  await expect(relationshipsTab).toHaveAttribute("aria-current", "page");
  await expect(sectionNavigation.getByRole("link", { name: "能力与活动" })).not.toHaveAttribute("aria-current");
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
