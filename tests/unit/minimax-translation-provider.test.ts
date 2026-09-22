// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxTranslationProvider } from "@/src/modules/providers/translation/minimax-translation";

describe("MiniMax translation timeout boundary", () => {
  it("reports provider timeout separately from caller cancellation", async () => {
    const provider = new MiniMaxTranslationProvider({
      apiKey: "test-key",
      timeoutMs: 5,
      fetchImplementation: async (_input, init) => {
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
        return new Response();
      },
    });

    await expect(provider.translate({ text: "hola", sourceLocale: "es-ES", targetLocale: "zh-CN" }))
      .rejects.toMatchObject({ code: "provider-timeout", retryable: true });
  });
});
