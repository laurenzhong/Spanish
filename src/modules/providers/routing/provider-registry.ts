import type { ProviderHealthStatus } from "./provider-health";

export const providerCapabilities = [
  "scenario-generation",
  "scenario-roleplay",
  "scenario-evaluation",
  "transcription",
  "pronunciation",
] as const;

export type ProviderCapability = (typeof providerCapabilities)[number];

export type ProviderRegistration = Readonly<{
  key: string;
  label: string;
  configured: boolean;
  capabilities: readonly ProviderCapability[];
  health: ProviderHealthStatus;
}>;

export class ProviderRegistryError extends Error {
  constructor(
    public readonly code: "PROVIDER_NOT_CONFIGURED" | "PROVIDER_PREFERENCE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ProviderRegistryError";
  }
}

const healthPriority: Readonly<Record<ProviderHealthStatus, number>> = {
  healthy: 0,
  configured: 1,
  degraded: 2,
  unavailable: 3,
};

export class ProviderRegistry {
  constructor(private readonly registrations: readonly ProviderRegistration[]) {}

  list(): readonly ProviderRegistration[] {
    return this.registrations;
  }

  select(capability: ProviderCapability, preferredKey: string | null): ProviderRegistration {
    const selectable = this.candidates(capability);
    if (preferredKey) {
      const preferred = selectable.find((candidate) => candidate.key === preferredKey);
      if (!preferred) {
        throw new ProviderRegistryError(
          "PROVIDER_PREFERENCE_INVALID",
          `The selected provider does not support ${capability} or is not configured.`,
        );
      }
      return preferred;
    }
    const selected = selectable[0];
    if (!selected) {
      throw new ProviderRegistryError(
        "PROVIDER_NOT_CONFIGURED",
        `No provider is configured for ${capability}.`,
      );
    }
    return selected;
  }

  selectFallback(
    capability: ProviderCapability,
    attemptedProviderKeys: readonly string[],
  ): ProviderRegistration | null {
    if (attemptedProviderKeys.length !== 1) return null;
    const attempted = new Set(attemptedProviderKeys);
    return this.candidates(capability).find((candidate) => !attempted.has(candidate.key)) ?? null;
  }

  supports(capability: ProviderCapability, providerKey: string): boolean {
    return this.candidates(capability).some((candidate) => candidate.key === providerKey);
  }

  private candidates(capability: ProviderCapability): ProviderRegistration[] {
    return this.registrations
      .filter((registration) =>
        registration.configured &&
        registration.health !== "unavailable" &&
        registration.capabilities.includes(capability),
      )
      .sort((left, right) => healthPriority[left.health] - healthPriority[right.health]);
  }
}

type ProviderEnvironment = Readonly<Partial<Record<
  "MINIMAX_API_KEY" | "OPENAI_API_KEY" | "SPEECHACE_API_KEY",
  string | undefined
>>>;

export function createServerProviderRegistrations(
  environment: ProviderEnvironment = {
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SPEECHACE_API_KEY: process.env.SPEECHACE_API_KEY,
  },
): readonly Omit<ProviderRegistration, "health">[] {
  return [
    {
      key: "minimax",
      label: "MiniMax",
      configured: Boolean(environment.MINIMAX_API_KEY?.trim()),
      capabilities: ["scenario-generation", "scenario-roleplay", "scenario-evaluation"],
    },
    {
      key: "openai",
      label: "OpenAI",
      configured: Boolean(environment.OPENAI_API_KEY?.trim()),
      capabilities: ["scenario-generation", "scenario-roleplay", "scenario-evaluation", "transcription"],
    },
    {
      key: "speechace",
      label: "SpeechAce",
      configured: Boolean(environment.SPEECHACE_API_KEY?.trim()),
      capabilities: ["pronunciation"],
    },
  ];
}
