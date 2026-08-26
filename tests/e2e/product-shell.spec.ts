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
    { name: "探索", path: "/explore", heading: "探索真实表达" },
    { name: "对话", path: "/chat", heading: "你的西语好友" },
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
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
});

test("keeps discovery and conversation entry points actionable", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/explore");

  await expect(page.getByRole("link", { name: "开始交流" })).toHaveAttribute(
    "href",
    "/learn?focus=start",
  );
  await page.getByRole("link", { name: "开始交流" }).click();
  await expect(page).toHaveURL(/\/learn\?focus=start$/);

  await page.goto("/chat");
  await page.getByRole("link", { name: "先练一句" }).click();
  await expect(page).toHaveURL(/\/learn\/practice$/);
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
  await expect(page.getByRole("heading", { name: "认识一个新朋友" })).toBeVisible();
  await expect(page.getByText("Mateo Ruiz")).toBeVisible();
  await page.getByRole("button", { name: "同意介绍" }).click();
  await expect(page.getByRole("status")).toContainText("已同意介绍");
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
  await expect(page.locator(".conversation-introductions [role=alert]")).toContainText("暂时无法读取好友介绍");
  allowSuccess = true;
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("Mateo Ruiz")).toBeVisible();
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
  const memory = page.getByRole("checkbox", { name: /喜欢摄影/ });
  await expect(memory).not.toBeChecked();
  await memory.check();
  await page.getByRole("button", { name: "同意介绍" }).click();
  await expect(page.getByRole("status")).toContainText("已同意介绍");
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

  await page.goto("/me");
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

  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "我的关系记忆" })).toBeVisible();
  await expect(page.getByText("喜欢摄影")).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "删除记忆" });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click({ force: true });
  await expect(page.getByRole("status")).toContainText("已删除");
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

  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "已保存的录音与转写" })).toBeVisible();
  await expect(page.getByText("¿Cómo va todo?")).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "删除转写" });
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click({ force: true });
  await expect(page.getByRole("status")).toContainText("已删除");
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

  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "删除我的账号数据" })).toBeVisible();
  const deleteAccountButton = page.getByRole("button", { name: "删除账号数据" });
  await deleteAccountButton.scrollIntoViewIfNeeded();
  await deleteAccountButton.click({ force: true });
  await expect(page.getByRole("status")).toHaveText("账号数据已删除。");
});

test("preserves the selected discovery direction on the learning page", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/explore");

  const needsCard = page.getByRole("link", { name: /表达需要/ });
  await expect(needsCard).toHaveAttribute("href", "/learn?focus=needs");
  await needsCard.click();

  await expect(page).toHaveURL(/\/learn\?focus=needs$/);
  await expect(page.locator(".focus-card")).toHaveAttribute("data-focus", "needs");
  await expect(page.getByRole("heading", { name: "把需要说得清楚又自然" })).toBeVisible();

  await page.goto("/explore");
  await page.getByRole("link", { name: /安静学习/ }).click();
  await expect(page).toHaveURL(/\/learn\?focus=silent$/);
  await expect(page.getByRole("status")).toContainText("暂时没有可开始的静默内容包");
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
