import { describe, expect, it, vi } from "vitest";

import {
  executeWithScenarioProviderFallback,
  streamWithScenarioProviderFallback,
} from "@/src/modules/providers/routing/provider-fallback";
import { ScenarioProviderError } from "@/src/modules/providers/routing/scenario-provider-router";

describe("scenario provider fallback orchestration", () => {
  it("switches once for a retryable non-streaming failure", async () => {
    const attempted: string[] = [];
    const result = await executeWithScenarioProviderFallback({
      providers: [{ key: "minimax" }, { key: "openai" }],
      execute: async (provider) => {
        attempted.push(provider.key);
        if (provider.key === "minimax") throw new ScenarioProviderError("provider-timeout", "timeout", true);
        return "ok";
      },
    });
    expect(result).toEqual({ provider: { key: "openai" }, result: "ok" });
    expect(attempted).toEqual(["minimax", "openai"]);
  });

  it("does not switch for cancellation or non-retryable invalid output", async () => {
    const fallback = vi.fn();
    await expect(executeWithScenarioProviderFallback({
      providers: [{ key: "minimax" }, { key: "openai" }],
      execute: async (provider) => {
        if (provider.key === "openai") fallback();
        throw new ScenarioProviderError("provider-cancelled", "cancelled", false);
      },
    })).rejects.toMatchObject({ code: "provider-cancelled" });
    await expect(executeWithScenarioProviderFallback({
      providers: [{ key: "minimax" }, { key: "openai" }],
      execute: async (provider) => {
        if (provider.key === "openai") fallback();
        throw new ScenarioProviderError("provider-response-invalid", "invalid", false);
      },
    })).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("switches a stream before its first delta but never after visible output", async () => {
    const beforeDelta = streamWithScenarioProviderFallback({
      providers: [{ key: "minimax" }, { key: "openai" }],
      stream: (provider) => provider.key === "minimax"
        ? failingStream(false)
        : successfulStream(provider.key),
    });
    const switched = [];
    for await (const item of beforeDelta) switched.push(item);
    expect(switched.map((item) => item.provider.key)).toEqual(["openai", "openai"]);

    const afterDelta = streamWithScenarioProviderFallback({
      providers: [{ key: "minimax" }, { key: "openai" }],
      stream: (provider) => provider.key === "minimax"
        ? failingStream(true)
        : successfulStream(provider.key),
    });
    const visible: Array<Readonly<{
      provider: Readonly<{ key: string }>;
      event: Readonly<{ type: "delta" | "done"; text?: string }>;
    }>> = [];
    await expect(async () => {
      for await (const item of afterDelta) visible.push(item);
    }).rejects.toMatchObject({ code: "provider-timeout" });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ provider: { key: "minimax" }, event: { type: "delta" } });
  });

  it("treats a stream without done as retryable only before visible output", async () => {
    const stream = streamWithScenarioProviderFallback({
      providers: [{ key: "minimax" }, { key: "openai" }],
      stream: (provider) => provider.key === "minimax" ? emptyStream() : successfulStream(provider.key),
      isTerminal: (event) => event.type === "done",
      incompleteError: () => new ScenarioProviderError("provider-unavailable", "incomplete", true),
    });
    const received = [];
    for await (const item of stream) received.push(item);
    expect(received.map((item) => item.provider.key)).toEqual(["openai", "openai"]);
  });
});

async function* failingStream(afterDelta: boolean) {
  if (afterDelta) yield { type: "delta" as const, text: "partial" };
  throw new ScenarioProviderError("provider-timeout", "timeout", true);
}

async function* successfulStream(provider: string) {
  yield { type: "delta" as const, text: provider };
  yield { type: "done" as const };
}

async function* emptyStream(): AsyncIterable<Readonly<{ type: "delta" | "done"; text?: string }>> {
  return;
}
