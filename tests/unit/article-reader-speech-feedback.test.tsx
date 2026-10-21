import { readAloudFake as speech } from "../helpers/read-aloud-fake";
vi.mock("@/src/modules/providers/tts/read-aloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/providers/tts/read-aloud")>();
  const { readAloudFake } = await import("../helpers/read-aloud-fake");
  return { ...actual, createReadAloud: readAloudFake.create };
});

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bundle from "@/content/bundles/alpha-core-v1.json";
import { ArticleReader } from "@/app/(product)/read/article/[articleId]/article-reader";
import { getArticle } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";
import type { ContentBundle } from "@/src/modules/content/schemas";

const publishedBundle = (): ContentBundle => {
  const source = structuredClone(bundle) as unknown as ContentBundle;
  source.articles[0] = {
    ...source.articles[0],
    status: "published",
    publishedAt: "2026-08-26T08:00:00Z",
    source: { ...source.articles[0].source, copyrightStatus: "cleared" },
  };
  return source;
};

async function renderReader() {
  const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
  if (!result.article) throw new Error("fixture article not found");
  render(<ArticleReader article={result.article} />);
  // Open the Explain panel on the first word, exactly like a reader would.
  const token = screen.getAllByRole("button").find((button) => button.classList.contains("reader-token"));
  if (!token) throw new Error("reader token missing");
  const user = userEvent.setup();
  await user.click(token);
  const panel = screen.getByRole("dialog", { name: "解释" });
  return { user, panel, word: token.textContent ?? "" };
}

describe("article reader read-aloud feedback", () => {
  beforeEach(() => {
    window.localStorage.clear();
    speech.reset();
    // The word lookup is unrelated here; keep it pending so the panel stays open.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports preparation failures and leaves the read-aloud button usable", async () => {
    const { user, panel, word } = await renderReader();
    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    expect(speech.attempts).toHaveLength(1);
    await act(async () => { speech.attempts[0].onerror?.(); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("暂时无法朗读"));
    expect(within(panel).getByRole("button", { name: `朗读 ${word}` })).toBeEnabled();
  });

  it("shows read-aloud activity and lets the reader stop from the word button", async () => {
    speech.speak.mockImplementation((attempt) => attempt.onstart?.());
    const { user, panel, word } = await renderReader();
    const button = within(panel).getByRole("button", { name: `朗读 ${word}` });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByRole("status")).toHaveTextContent("正在朗读");

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(within(panel).queryByRole("status")).not.toBeInTheDocument();
    expect(speech.cancel).toHaveBeenCalledOnce();
  });

  it("shows preparation until the browser confirms that speech started", async () => {
    const spoken = speech.attempts;
    const { user, panel, word } = await renderReader();
    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    expect(within(panel).getByRole("status")).toHaveTextContent("正在准备语音");
    expect(within(panel).getByRole("status")).not.toHaveTextContent("正在朗读");
    await act(async () => { spoken[0].onstart?.(); });
    expect(within(panel).getByRole("status")).toHaveTextContent("正在朗读");
  });

  it("keeps the newer word active when an older speech attempt settles", async () => {
    const spoken = speech.attempts;
    speech.speak.mockImplementation((attempt) => attempt.onstart?.());
    const { user, panel, word } = await renderReader();
    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    const nextToken = screen.getAllByRole("button").filter((button) => button.classList.contains("reader-token"))[1];
    await user.click(nextToken);
    const nextButton = within(screen.getByRole("dialog", { name: "解释" })).getByRole("button", { name: `朗读 ${nextToken.textContent}` });
    await user.click(nextButton);

    expect(nextButton).toHaveAttribute("aria-pressed", "true");
    await act(async () => { spoken[0].onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent); });
    expect(nextButton).toHaveAttribute("aria-pressed", "true");
    await act(async () => { spoken[1].onend?.(); });
    await waitFor(() => expect(nextButton).toHaveAttribute("aria-pressed", "false"));
  });

  it("clears the error when the reader retries successfully", async () => {
    const { user, panel, word } = await renderReader();
    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    await act(async () => { speech.attempts[0].onerror?.(); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("暂时无法朗读"));
    speech.state.completeImmediately = true;
    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(speech.attempts).toHaveLength(2);
  });
});
