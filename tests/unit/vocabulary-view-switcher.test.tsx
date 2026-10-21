import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

import { VocabularyViewSwitcher, vocabularyViewHref, type VocabularyView, type VocabularyViewQuery } from "@/src/modules/lexicon-corpus";

const labels = ["学习词表", "语料高频词", "正式词元"] as const;

function renderSwitcher(view: VocabularyView, query: VocabularyViewQuery = {}) {
  render(<VocabularyViewSwitcher view={view} query={query} />);
}

function viewLink(label: string): HTMLElement {
  return screen.getByRole("link", { name: label });
}

describe("vocabulary view switcher", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers the three shelves as one labelled navigation with Chinese labels", () => {
    renderSwitcher("study");

    const navigation = screen.getByRole("navigation", { name: "词汇视图" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual([...labels]);
  });

  it("does not pretend to be an ARIA tab set, because each view is its own URL", () => {
    renderSwitcher("study");

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("marks only the link matching the current URL view as the current page", () => {
    renderSwitcher("frequency");

    expect(viewLink("语料高频词")).toHaveAttribute("aria-current", "page");
    for (const label of ["学习词表", "正式词元"]) {
      expect(viewLink(label)).not.toHaveAttribute("aria-current");
    }
  });

  it("sends every link to its own URL instead of swapping panels locally", () => {
    renderSwitcher("study");

    expect(viewLink("学习词表")).toHaveAttribute("href", "/read/vocabulary?view=study");
    expect(viewLink("语料高频词")).toHaveAttribute("href", "/read/vocabulary?view=frequency");
    expect(viewLink("正式词元")).toHaveAttribute("href", "/read/vocabulary?view=lexicon");
  });

  it("keeps search and pageSize but drops lexicon-only filters when the target view cannot use them", () => {
    renderSwitcher("lexicon", { search: "comer", pageSize: 12, intent: "revisit", lemmaStatus: "verified" });

    expect(viewLink("语料高频词")).toHaveAttribute("href", "/read/vocabulary?view=frequency&search=comer&pageSize=12");
    expect(viewLink("学习词表")).toHaveAttribute("href", "/read/vocabulary?view=study&search=comer&pageSize=12");
    // Staying on the lexicon shelf keeps its own filters.
    expect(viewLink("正式词元")).toHaveAttribute("href", "/read/vocabulary?view=lexicon&search=comer&pageSize=12&intent=revisit&lemmaStatus=verified");
  });

  it("drops the current page from every destination", () => {
    // `page` belongs to the view being left; a switch starts the next view at
    // its first page even when the current URL is deep in a list.
    renderSwitcher("lexicon", { search: "comer", pageSize: 12 });

    for (const label of labels) {
      expect(viewLink(label).getAttribute("href")).not.toMatch(/[?&]page=/u);
    }
  });

  it("points at the bare view URL when the reader has no preferences to carry", () => {
    expect(vocabularyViewHref("study", {})).toBe("/read/vocabulary?view=study");
    expect(vocabularyViewHref("frequency", {})).toBe("/read/vocabulary?view=frequency");
  });
});
