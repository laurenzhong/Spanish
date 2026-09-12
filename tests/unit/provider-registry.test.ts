import { describe, expect, it } from "vitest";

import {
  ProviderRegistry,
  createServerProviderRegistrations,
} from "@/src/modules/providers/routing/provider-registry";
import { deriveProviderHealth } from "@/src/modules/providers/routing/provider-health";

const now = new Date("2026-09-12T08:00:00.000Z");

describe("provider registry and health", () => {
  it("derives health without issuing a paid probe and ignores cancellation", () => {
    expect(deriveProviderHealth({ configured: false, observations: [], now })).toBe("unavailable");
    expect(deriveProviderHealth({ configured: true, observations: [], now })).toBe("configured");
    expect(deriveProviderHealth({
      configured: true,
      observations: [
        { status: "cancelled", completedAt: new Date("2026-09-12T07:59:00.000Z") },
        { status: "succeeded", completedAt: new Date("2026-09-12T07:58:00.000Z") },
      ],
      now,
    })).toBe("healthy");
    expect(deriveProviderHealth({
      configured: true,
      observations: [{ status: "failed", completedAt: new Date("2026-09-12T07:59:00.000Z") }],
      now,
    })).toBe("degraded");
    expect(deriveProviderHealth({
      configured: true,
      observations: [{ status: "failed", completedAt: new Date("2026-09-10T07:59:00.000Z") }],
      now,
    })).toBe("configured");
  });

  it("registers only server configuration and never exposes credentials", () => {
    const registrations = createServerProviderRegistrations({
      MINIMAX_API_KEY: "minimax-secret",
      OPENAI_API_KEY: "",
      SPEECHACE_API_KEY: "speechace-secret",
    });
    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "minimax", configured: true }),
      expect.objectContaining({ key: "openai", configured: false }),
      expect.objectContaining({ key: "speechace", configured: true }),
    ]));
    expect(JSON.stringify(registrations)).not.toContain("secret");
  });

  it("honors a supported configured preference and otherwise uses health priority", () => {
    const registry = new ProviderRegistry([
      { key: "minimax", label: "MiniMax", configured: true, capabilities: ["scenario-roleplay"], health: "degraded" },
      { key: "openai", label: "OpenAI", configured: true, capabilities: ["scenario-roleplay", "transcription"], health: "healthy" },
      { key: "speechace", label: "SpeechAce", configured: true, capabilities: ["pronunciation"], health: "configured" },
    ]);

    expect(registry.select("scenario-roleplay", "minimax").key).toBe("minimax");
    expect(registry.select("scenario-roleplay", null).key).toBe("openai");
    expect(() => registry.select("transcription", "minimax")).toThrowError(
      expect.objectContaining({ code: "PROVIDER_PREFERENCE_INVALID" }),
    );
    expect(() => registry.select("pronunciation", "missing")).toThrowError(
      expect.objectContaining({ code: "PROVIDER_PREFERENCE_INVALID" }),
    );
  });

  it("returns a single different fallback and never selects unavailable providers", () => {
    const registry = new ProviderRegistry([
      { key: "minimax", label: "MiniMax", configured: true, capabilities: ["scenario-evaluation"], health: "healthy" },
      { key: "openai", label: "OpenAI", configured: true, capabilities: ["scenario-evaluation"], health: "configured" },
      { key: "offline", label: "Offline", configured: false, capabilities: ["scenario-evaluation"], health: "unavailable" },
    ]);
    expect(registry.selectFallback("scenario-evaluation", ["minimax"])?.key).toBe("openai");
    expect(registry.selectFallback("scenario-evaluation", ["minimax", "openai"])).toBeNull();
  });
});
