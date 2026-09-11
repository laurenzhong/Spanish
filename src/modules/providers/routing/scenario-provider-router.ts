export const scenarioProviderCapabilities = [
  "scenario-generation",
  "scenario-roleplay",
  "scenario-evaluation",
] as const;

export type ScenarioProviderCapability = (typeof scenarioProviderCapabilities)[number];

export const scenarioProviderErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
  "PROVIDER_NOT_CONFIGURED",
] as const;

export type ScenarioProviderErrorCode = (typeof scenarioProviderErrorCodes)[number];

export class ScenarioProviderError extends Error {
  constructor(
    public readonly code: ScenarioProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ScenarioProviderError";
  }
}

export type ScenarioProviderRegistration = Readonly<{
  key: string;
  capabilities: readonly ScenarioProviderCapability[];
  healthy: boolean;
}>;

export type ScenarioProviderPreferences = Readonly<
  Partial<Record<ScenarioProviderCapability, string>>
>;

export class ScenarioProviderRouter {
  constructor(private readonly registry: readonly ScenarioProviderRegistration[]) {}

  selectPrimary(
    capability: ScenarioProviderCapability,
    preferences: ScenarioProviderPreferences,
  ): ScenarioProviderRegistration {
    const candidates = this.candidates(capability);
    const preferredKey = preferences[capability];
    const preferred = preferredKey
      ? candidates.find((candidate) => candidate.key === preferredKey)
      : undefined;
    const selected = preferred ?? candidates[0];
    if (!selected) {
      throw new ScenarioProviderError(
        "PROVIDER_NOT_CONFIGURED",
        `No healthy provider is configured for ${capability}.`,
        false,
      );
    }
    return selected;
  }

  selectFallback(input: Readonly<{
    capability: ScenarioProviderCapability;
    attemptedProviderKeys: readonly string[];
    hasVisibleDelta: boolean;
  }>): ScenarioProviderRegistration | null {
    if (input.hasVisibleDelta || input.attemptedProviderKeys.length !== 1) return null;
    const attempted = new Set(input.attemptedProviderKeys);
    return this.candidates(input.capability).find((candidate) => !attempted.has(candidate.key)) ?? null;
  }

  private candidates(capability: ScenarioProviderCapability) {
    return this.registry.filter(
      (entry) => entry.healthy && entry.capabilities.includes(capability),
    );
  }
}

export function shouldFallbackScenarioProvider(
  error: unknown,
  context: Readonly<{ attempts: number; hasVisibleDelta: boolean }>,
): boolean {
  return error instanceof ScenarioProviderError &&
    error.retryable &&
    error.code !== "provider-cancelled" &&
    context.attempts === 1 &&
    !context.hasVisibleDelta;
}
