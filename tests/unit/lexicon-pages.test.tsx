import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: vi.fn() };
});

import { PhraseLibrary, ReadSectionNavigation, VocabularyLibrary } from "@/src/modules/lexicon-corpus";

const vocabulary = {
  id: "10000000-0000-4000-8000-000000000001",
  lemma: "comer",
  normalizedLemma: "comer",
  partOfSpeech: "verb",
  lemmaStatus: "verified" as const,
  meaningZh: "吃",
  forms: ["comer", "comiendo"],
  occurrenceCount: 2,
  intent: null,
  revision: 1,
};
const phrase = {
  id: "20000000-0000-4000-8000-000000000001",
  expression: "¿Qué tal?",
  normalizedExpression: "que tal",
  meaningZh: "怎么样？",
  pragmaticPurpose: "轻松问候",
  register: "neutral",
  region: "es-ES",
  cefr: "A2",
  variants: ["Que tal"],
  occurrenceCount: 1,
  intent: null,
  revision: 1,
};

describe("lexicon pages and controls", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders vocabulary metadata and updates a personal intent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { revision: 2 } }), { status: 200 }));
    const user = userEvent.setup();
    render(<VocabularyLibrary items={[vocabulary]} />);
    expect(screen.getByRole("heading", { name: "comer" })).toBeInTheDocument();
    expect(screen.getByText("2 个出现")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "想复现" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(vocabulary.id), expect.objectContaining({ method: "PUT" })));
    expect(screen.getByRole("button", { name: "想复现" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders phrase purpose and honest empty states", () => {
    render(<PhraseLibrary items={[phrase]} />);
    expect(screen.getByRole("heading", { name: "¿Qué tal?" })).toBeInTheDocument();
    expect(screen.getByText("轻松问候")).toBeInTheDocument();
    render(<VocabularyLibrary items={[]} />);
    expect(screen.getByRole("heading", { name: "还没有词汇" })).toBeInTheDocument();
  });

  it("keeps the four reading destinations visible", () => {
    render(<ReadSectionNavigation active="vocabulary" />);
    expect(screen.getByRole("link", { name: "文章" })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("link", { name: "词汇" })).toHaveAttribute("href", "/read/vocabulary");
    expect(screen.getByRole("link", { name: "短语" })).toHaveAttribute("href", "/read/phrases");
    expect(screen.getByRole("link", { name: "语料" })).toHaveAttribute("href", "/read/corpus");
  });
});
