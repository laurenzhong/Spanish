import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

// Import the schema directly instead of the module barrel: the barrel also
// re-exports client UI that other in-flight work touches, and this test only
// needs the server-side query contract the landing page parses.
import { vocabularyQuerySchema } from "@/src/modules/lexicon-corpus/schemas";
import { VocabularyShelfControls } from "@/src/modules/lexicon-corpus/ui/lexicon-shelf-controls";
import { VocabularyWordGrid, type VocabularyWordGridItem } from "@/src/modules/reading/ui/vocabulary-word-grid";

const items: readonly VocabularyWordGridItem[] = [
  { id: "word:casa", text: "casa", count: 1, meaning: null, context: "Voy a casa.", source: "Una historia" },
  { id: "word:comer", text: "comer", count: 3, meaning: "吃", context: null, source: null },
];

/** The four status filters the grid renders, with the intent each must send. */
const statusFilters = [
  ["全部", null],
  ["已熟悉", "familiar"],
  ["想复现", "revisit"],
  ["暂不学习", "ignore"],
] as const;

function paramsOf(name: RegExp): URLSearchParams {
  const href = screen.getByRole("link", { name }).getAttribute("href") ?? "";
  return new URLSearchParams(href.includes("?") ? href.slice(href.indexOf("?") + 1) : "");
}

describe("vocabulary word grid", () => {
  afterEach(() => cleanup());

  it("renders the order it is given and opens source context", async () => {
    const user = userEvent.setup();
    render(<VocabularyWordGrid search="" total={2} items={items} />);
    const words = screen.getAllByRole("button");
    expect(words[0]).toHaveTextContent("casa");
    await user.click(screen.getByRole("button", { name: /casa/ }));
    expect(screen.getByRole("heading", { name: "casa" })).toBeInTheDocument();
    expect(screen.getByText("Voy a casa.")).toBeInTheDocument();
    expect(screen.getByText("Una historia")).toBeInTheDocument();
  });

  // The shelf order belongs to the server: it is the reference-list rank order,
  // function words removed (task-12). The grid used to re-sort by our corpus
  // count, which put the corpus head back on top; a future client-side sort must
  // fail here instead of silently winning. `comer` deliberately out-counts
  // `casa` so a count sort is observable.
  it("preserves the server-provided order instead of re-sorting by occurrence count", () => {
    render(<VocabularyWordGrid search="" total={2} items={items} />);
    expect(screen.getAllByRole("button").map((button) => button.querySelector("span")?.textContent)).toEqual(["casa", "comer"]);
  });

  // B1: `intent` is a server-side `user_lexical_intents` filter. Sending it
  // without `view` falls back to `study`, whose list never reads it, so the
  // click did nothing. Every status link must land on `view=lexicon` and the
  // parameters must survive the page's own query schema.
  it("sends every status filter to the lexicon view with an intent the server schema accepts", () => {
    render(<VocabularyWordGrid search="casa" total={2} items={items} />);
    for (const [label, intent] of statusFilters) {
      const params = paramsOf(new RegExp(label));
      expect(params.get("view")).toBe("lexicon");
      expect(params.get("search")).toBe("casa");
      const parsed = vocabularyQuerySchema.safeParse(Object.fromEntries(params));
      expect(parsed.success).toBe(true);
      expect(parsed.success ? parsed.data.intent ?? null : "invalid").toBe(intent);
      expect(parsed.success ? parsed.data.search : undefined).toBe("casa");
    }
  });

  // B2: the shelf tab for saved words and phrases is `itemType=phrase`; the
  // public phrase library (`/read/phrases`) is not the user's saved shelf.
  it("points 保存的短语 at the saved shelf instead of the public phrase library", () => {
    render(<VocabularyWordGrid search="casa" total={2} items={items} />);
    for (const label of [/保存的单词/, /保存的短语/]) {
      const href = screen.getByRole("link", { name: label }).getAttribute("href") ?? "";
      expect(href.startsWith("/read/saved-items?")).toBe(true);
      expect(href.includes("/read/phrases")).toBe(false);
      const params = paramsOf(label);
      expect(params.get("itemType")).toBe("phrase");
      expect(params.get("search")).toBe("casa");
    }
  });

  // B5: the same familiar/revisit/ignore enum is rendered on several surfaces,
  // and two different Chinese wordings had drifted apart. Pin the grid's labels
  // against the lexicon shelf controls (the canonical server-side wording) so
  // they cannot drift apart again.
  it("keeps the three status labels literally aligned with the lexicon shelf controls", () => {
    render(<VocabularyWordGrid search="" total={2} items={items} />);
    // getByRole throws if the grid ever stops rendering one of the labels.
    const gridLabels = Object.fromEntries(statusFilters.slice(1).map(([label, intent]) => [intent, screen.getByRole("link", { name: label }).textContent]));
    cleanup();
    render(<VocabularyShelfControls query={vocabularyQuerySchema.parse({})} total={0} view="lexicon" />);
    const options = [...(screen.getByLabelText(/学习状态/) as HTMLSelectElement).options];
    for (const [intent, label] of Object.entries(gridLabels)) {
      expect(options.find((option) => option.value === intent)?.textContent).toBe(label);
    }
    expect(Object.keys(gridLabels)).toHaveLength(3);
  });

  // B6: the frequency query cannot know whether the viewer saved a word, so the
  // `saved` flag was hard-coded false and its entry never rendered. Reproduce it
  // by forcing the old flag: before the fix this rendered the "查看保存记录" link,
  // after the fix the field is gone (the `@ts-expect-error` fails typecheck if it
  // comes back) and no saved entry may render.
  it("never renders a saved-records entry, even when a caller passes a stale saved flag", async () => {
    const user = userEvent.setup();
    render(<VocabularyWordGrid
      search=""
      total={3}
      items={[
        ...items,
        {
          id: "word:salir",
          text: "salir",
          count: 2,
          meaning: null,
          context: null,
          source: null,
          // @ts-expect-error `saved` was removed in READ-SHELF-001 B6; a caller that still passes it must fail typecheck.
          saved: true,
        },
      ]}
    />);
    await user.click(screen.getByRole("button", { name: /salir/ }));
    const detail = screen.getByRole("heading", { name: "salir" }).closest("aside");
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText("查看保存记录")).toBeNull();
  });
});
