import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

import { VocabularyStudyList } from "@/src/modules/reading/ui/vocabulary-study-list";

const words = [
  {
    id: "casa",
    headword: "casa",
    partOfSpeech: "名词",
    cefr: "A1",
    meanings: [{ meaning: "房子、家", usage: "en casa 表示在家" }],
    collocations: ["en casa"],
    examples: ["Hoy me quedo en casa."],
    forms: ["casas"],
    occurrenceCount: null,
  },
] as const;

type FakeUtterance = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

describe("vocabulary read-aloud feedback", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    });
    // The corpus-example lookup is unrelated to reading aloud; keep it pending so
    // the test only observes the speech path.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("explains itself instead of staying silent when the engine drops the utterance", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spoken: FakeUtterance[] = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        getVoices: () => [],
        resume: vi.fn(),
        speak: (utterance: FakeUtterance) => spoken.push(utterance),
      },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<VocabularyStudyList words={words} storageScope="user-1" />);

    await user.click(screen.getByRole("button", { name: /casa/ }));
    const card = within(screen.getByRole("complementary", { name: "casa 学习卡片" }));
    const readAloud = card.getByRole("button", { name: "朗读单词" });
    await user.click(readAloud);

    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("casa");
    // No Spanish voice is offered here, so there is no pinned voice to retry
    // with: the watchdog must report the silence on the first deadline.

    // The old implementation waited forever: no sound, no message, and the button
    // stayed on "停止朗读" as if it were still reading.
    await vi.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("浏览器没有出声"));
    expect(card.getByRole("button", { name: "朗读单词" })).toBeInTheDocument();
  });

  it("clears the speaking state as soon as the utterance finishes", async () => {
    const spoken: FakeUtterance[] = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        getVoices: () => [],
        resume: vi.fn(),
        speak: (utterance: FakeUtterance) => {
          spoken.push(utterance);
          utterance.onstart?.();
          utterance.onend?.();
        },
      },
    });
    const user = userEvent.setup();
    render(<VocabularyStudyList words={words} storageScope="user-1" />);

    await user.click(screen.getByRole("button", { name: /casa/ }));
    const card = within(screen.getByRole("complementary", { name: "casa 学习卡片" }));
    await user.click(card.getByRole("button", { name: "朗读单词" }));

    await waitFor(() => expect(card.getByRole("button", { name: "朗读单词" })).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
