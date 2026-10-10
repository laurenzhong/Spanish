import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

import { VocabularyWordGrid } from "@/src/modules/reading/ui/vocabulary-word-grid";

describe("vocabulary word grid", () => {
  afterEach(() => cleanup());

  it("sorts words by occurrence count and opens source context", async () => {
    const user = userEvent.setup();
    render(<VocabularyWordGrid search="" total={2} items={[
      { id: "saved:1", text: "casa", count: 1, meaning: null, context: "Voy a casa.", source: "Una historia", saved: true },
      { id: "lexeme:2", text: "comer", count: 3, meaning: "吃", context: null, source: null, saved: false },
    ]} />);
    const words = screen.getAllByRole("button");
    expect(words[0]).toHaveTextContent("comer");
    await user.click(screen.getByRole("button", { name: /casa/ }));
    expect(screen.getByRole("heading", { name: "casa" })).toBeInTheDocument();
    expect(screen.getByText("Voy a casa.")).toBeInTheDocument();
    expect(screen.getByText("Una historia")).toBeInTheDocument();
  });
});
