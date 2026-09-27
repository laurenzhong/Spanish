import { describe, expect, it, vi } from "vitest";

import {
  CharacterRuntimeError,
  isConversationStaticFallbackAllowed,
  resolveConversationCharacter,
} from "@/src/modules/conversation";
import type { CharacterRepository } from "@/src/modules/characters";

function repositoryWith(status: "draft" | "published") {
  return {
    findByStableVersion: vi.fn().mockResolvedValue({
      id: "character-id",
      stableKey: "lucia",
      version: 1,
      status,
      displayName: "Lucía Martín",
      avatarUrl: null,
      homeLocation: "Madrid",
      profile: { identity: {}, personality: {}, relationships: [], changeLog: [] },
      facts: [],
    }),
  } as unknown as CharacterRepository;
}

function repositoryReturning(value: Partial<Awaited<ReturnType<CharacterRepository["findByStableVersion"]>>> & { status: "published" | "draft" }) {
  return {
    findByStableVersion: vi.fn().mockResolvedValue({
      id: "character-id",
      stableKey: "lucia",
      version: 1,
      displayName: "Lucía Martín",
      avatarUrl: null,
      homeLocation: "Madrid",
      profile: { identity: {}, personality: {}, relationships: [], changeLog: [] },
      facts: [],
      ...value,
    }),
  } as unknown as CharacterRepository;
}

describe("character runtime release gate", () => {
  it("allows only the explicitly injected Lucía fixture without persistence", async () => {
    const resolved = await resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      allowStaticFallback: true,
    });
    expect(resolved.catalog.key).toBe("lucia");
    expect(resolved.persisted).toBeNull();
  });

  it("keeps draft Mateo unavailable even when a fake runtime is injected", async () => {
    await expect(resolveConversationCharacter({
      characterKey: "mateo",
      characterVersion: 1,
      allowStaticFallback: true,
    })).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });
  });

  it("requires a published persisted version when a repository is present", async () => {
    await expect(resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository: repositoryWith("draft"),
    })).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });

    const resolved = await resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository: repositoryWith("published"),
    });
    expect(resolved.persisted?.status).toBe("published");
  });

  it("fails closed for persisted canon facts without a stored reveal policy", async () => {
    const resolved = await resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository: repositoryReturning({
        status: "published",
        facts: [
          {
            factKey: "preference.private-interest",
            value: { statement: "A sensitive detail" },
            sensitivity: "sensitive",
            version: 1,
            isActive: true,
          },
          {
            factKey: "boundary.ai-identity",
            value: { statement: "Soy un personaje de IA." },
            sensitivity: "normal",
            version: 1,
            isActive: true,
          },
        ],
      }),
    });
    expect(resolved.catalog.snapshot.facts).toEqual([
      expect.objectContaining({ factKey: "preference.private-interest", reveal: "never" }),
      expect.objectContaining({ factKey: "boundary.ai-identity", reveal: "direct" }),
    ]);
  });

  it("does not resurrect static biography when a published row has no active facts", async () => {
    const resolved = await resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository: repositoryReturning({
        status: "published",
        facts: [],
      }),
    });

    expect(resolved.catalog.snapshot.facts).toEqual([
      expect.objectContaining({ factKey: "boundary.ai-identity", reveal: "direct" }),
    ]);
  });

  it("rejects a repository result whose identity does not match the requested version", async () => {
    await expect(resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository: repositoryReturning({ status: "published", stableKey: "mateo" }),
    })).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });

    await expect(resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository: repositoryReturning({ status: "published", version: 2 }),
    })).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });
  });

  it("fails closed when the character repository throws", async () => {
    const repository = {
      findByStableVersion: vi.fn().mockRejectedValue(new Error("database unavailable")),
    } as unknown as CharacterRepository;
    await expect(resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository,
    })).rejects.toMatchObject({ code: "CHARACTER_RUNTIME_UNAVAILABLE" });
  });

  it("fails closed when persistence is absent and fallback is not explicit", async () => {
    await expect(resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
    })).rejects.toMatchObject({ code: "CHARACTER_RUNTIME_UNAVAILABLE" });
    expect(isConversationStaticFallbackAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(isConversationStaticFallbackAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("never honors an explicitly requested static fallback in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(resolveConversationCharacter({
        characterKey: "lucia",
        characterVersion: 1,
        allowStaticFallback: true,
      })).rejects.toMatchObject({ code: "CHARACTER_RUNTIME_UNAVAILABLE" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not expose Lucía's proactive capability through a draft role", async () => {
    const repository = repositoryWith("published");
    await expect(resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      repository,
      requiredCapability: "proactiveMessages",
    })).resolves.toBeTruthy();
    await expect(resolveConversationCharacter({
      characterKey: "mateo",
      characterVersion: 1,
      repository,
      requiredCapability: "proactiveMessages",
    })).rejects.toBeInstanceOf(CharacterRuntimeError);
  });
});
