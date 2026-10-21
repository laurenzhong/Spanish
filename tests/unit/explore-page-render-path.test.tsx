import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the /explore render path.
 *
 * The page used to await `getExploreDashboardForUser` (a `user_content_pack_states`
 * read) and `getExploreLibraryForUser` (personal scenarios, saved expressions,
 * article highlights, scenario reviews) in one `Promise.all` before it could
 * return any tree, so every visit held the public catalogue open behind a
 * private round trip to the remote database.
 *
 * Here the private reads are replaced by promises that never settle. If the
 * page waits for them, the assertion below fails on timeout; with the public
 * catalogue read from the content bundles, the tree is returned immediately.
 */
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

// The database client and the scenario-library factory are exactly where the
// per-user reads live. Mocking them to hang proves the page never reaches for
// them, and would keep this test hanging (not passing) if it did.
vi.mock("@/src/shared/db/client", () => ({
  getDatabase: () => ({ mocked: "explore-page-hanging-database" }),
}));

vi.mock("@/src/modules/scenario-practice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/scenario-practice")>();
  return {
    ...actual,
    createDrizzleScenarioLibraryRepository: () => ({
      listSavedExpressions: () => new Promise(() => {}),
      listGenerationSources: () => new Promise(() => {}),
      listPersonalSuggestionCandidates: () => new Promise(() => {}),
    }),
  };
});

import ExplorePage from "@/app/(product)/explore/page";

const blocked = Symbol("blocked");

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | typeof blocked> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof blocked>((resolve) => { timer = setTimeout(() => resolve(blocked), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}): Promise<void> {
  const page = await settleWithin(
    ExplorePage({ searchParams: Promise.resolve(searchParams) }),
    1000,
  );
  expect(page, "ExplorePage did not return a tree: it is still waiting on a per-user read").not.toBe(blocked);
  render(page as ReactElement);
}

describe("explore page render path", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns the public scenarios without waiting for the per-user reads", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    await renderPage();

    expect(screen.getByRole("tab", { name: "场景" })).toHaveAttribute("aria-selected", "true");
    // All nine reviewed public scenarios, straight from the content bundles.
    expect(document.querySelectorAll(".explore-scenario-grid > a")).toHaveLength(9);
    expect(screen.getByText(/校园办事：注册与材料/u)).toBeInTheDocument();
    expect(screen.getByText(/交通沟通：买票与改签/u)).toBeInTheDocument();
    expect(screen.queryByText(/私人内容暂不可用/u)).not.toBeInTheDocument();
  });

  it("returns the public packs from the bundles alone", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    await renderPage({ view: "packs" });

    expect(screen.getByRole("tab", { name: "内容包" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll(".explore-pack-card")).toHaveLength(1);
    expect(screen.getByText("咖啡馆里的新朋友")).toBeInTheDocument();
  });

  it("keeps the legacy query parameters on the tree it returns", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });

    await renderPage({ q: "校园", filter: "available", saved: "1", view: "scenarios" });

    expect(screen.getByRole("searchbox")).toHaveValue("校园");
    expect(screen.getByRole("button", { name: /^可立即开始/u })).toBeInTheDocument();
    expect(screen.getByText(/校园办事：注册与材料/u)).toBeInTheDocument();
  });

  it("still sends a signed-out visitor to the login page", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(ExplorePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login?next=%2Fexplore");
  });
});
