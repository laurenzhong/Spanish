import { describe, expect, it, vi } from "vitest";

import {
  buildProviderStatus,
  updateProviderPreference,
  type UserProviderPreferenceRepository,
} from "@/src/modules/providers/provider-settings";

const registrations = [
  { key: "minimax", label: "MiniMax", configured: true, capabilities: ["scenario-generation", "scenario-roleplay", "scenario-evaluation"] as const },
  { key: "openai", label: "OpenAI", configured: false, capabilities: ["scenario-generation", "scenario-roleplay", "scenario-evaluation", "transcription"] as const },
  { key: "speechace", label: "SpeechAce", configured: true, capabilities: ["pronunciation"] as const },
];

function preferenceRepository(): UserProviderPreferenceRepository {
  return {
    list: vi.fn(async () => [{ capability: "scenario-roleplay" as const, providerKey: "openai" }]),
    set: vi.fn(async (_userId, capability, providerKey) => ({ capability, providerKey })),
    clear: vi.fn(async () => undefined),
  };
}

describe("provider settings application", () => {
  it("reports each capability without secrets and falls back from a now-unconfigured preference", () => {
    const status = buildProviderStatus({
      registrations,
      preferences: [{ capability: "scenario-roleplay", providerKey: "openai" }],
      observations: [
        { capability: "scenario-roleplay", providerKey: "minimax", lastSuccessAt: new Date("2026-09-12T07:00:00.000Z"), lastFailureAt: null },
      ],
      now: new Date("2026-09-12T08:00:00.000Z"),
    });
    const roleplay = status.capabilities.find((item) => item.capability === "scenario-roleplay");
    expect(roleplay).toMatchObject({
      selectedProviderKey: "openai",
      selectedProviderAvailable: false,
      effectiveProviderKey: "minimax",
      canAutoSwitch: false,
    });
    expect(roleplay?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "minimax", status: "healthy", configured: true }),
      expect.objectContaining({ key: "openai", status: "unavailable", configured: false }),
    ]));
    expect(JSON.stringify(status)).not.toMatch(/api[_-]?key|secret|prompt/iu);
  });

  it("validates writes against configured capability support and supports automatic selection", async () => {
    const repository = preferenceRepository();
    await expect(updateProviderPreference({
      repository,
      registrations,
      userId: "user-1",
      capability: "scenario-roleplay",
      providerKey: "openai",
    })).rejects.toThrowError(expect.objectContaining({ code: "PROVIDER_PREFERENCE_INVALID" }));
    await expect(updateProviderPreference({
      repository,
      registrations,
      userId: "user-1",
      capability: "scenario-roleplay",
      providerKey: "minimax",
    })).resolves.toEqual({ capability: "scenario-roleplay", providerKey: "minimax" });
    await expect(updateProviderPreference({
      repository,
      registrations,
      userId: "user-1",
      capability: "scenario-roleplay",
      providerKey: null,
    })).resolves.toBeNull();
    expect(repository.clear).toHaveBeenCalledWith("user-1", "scenario-roleplay");
  });
});
