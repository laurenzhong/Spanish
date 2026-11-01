import { DEFAULT_MINIMAX_TEXT_MODEL } from "../../providers/minimax/text-model";

import { z } from "zod";

import { findCharacterRuntimeDefinition, isCharacterConversationEnabled } from "@/src/modules/characters";
import { TranslationError, type TranslationProvider, type TranslationResult } from "@/src/modules/providers/translation/translation";
import { findConversationCharacter } from "../domain/character-catalog";
import { isConversationStaticFallbackAllowed } from "./resolve-character-runtime";
import type { ExpressionAssistRepository } from "../repositories/expression-assist-repository";
import { expressionAssistDataSchema, expressionAssistRequestSchema, type ExpressionAssistData, type ExpressionAssistRequest } from "../schemas/expression-assist";
import { ExpressionAssistError } from "./expression-assist-error";
import type { ExpressionAssistAttempts } from "./expression-assist-attempts";
export { ExpressionAssistError } from "./expression-assist-error";

type Observation = Omit<TranslationResult, "text"> & Readonly<{ status: "succeeded" | "failed" | "cancelled"; errorType?: string }>;
type Dependencies = Readonly<{
  repository?: ExpressionAssistRepository;
  getContactStatus?: (userId: string, characterKey: string) => Promise<string>;
  provider: TranslationProvider;
  signal?: AbortSignal;
  allowStaticFallback?: boolean;
  onProviderResult?: (result: Observation) => void | Promise<void>;
  attempts?: ExpressionAssistAttempts;
}>;

function observe(dependencies: Dependencies, observation: Observation): void {
  try { void Promise.resolve(dependencies.onProviderResult?.(observation)).catch(() => undefined); }
  catch { /* Provider metadata is best-effort and must not block a private draft. */ }
}

const providerResultSchema = z.object({
  text: z.string().max(2_000).trim().min(1).refine((text) => /\p{Script=Latin}/u.test(text) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)),
  provider: z.enum(["minimax", "fake"]), modelVersion: z.string().min(1).max(128),
  providerRequestId: z.string().max(128).nullable(), latencyMs: z.number().finite().nonnegative(),
  estimatedCostMicros: z.number().finite().nonnegative().nullable(),
});

/** Private, transient assistance: there is no message, memory or evidence write port. */
export async function assistExpression(
  input: ExpressionAssistRequest & Readonly<{ userId: string; characterKey: string }>,
  dependencies: Dependencies,
): Promise<ExpressionAssistData> {
  const parsed = expressionAssistRequestSchema.safeParse({ text: input.text, characterVersion: input.characterVersion, attemptId: input.attemptId });
  if (!parsed.success) throw new ExpressionAssistError("VALIDATION_FAILED", 400);
  const command = parsed.data;
  const controller = new AbortController();
  let timedOut = false;
  const cancellationError = () => new TranslationError(timedOut ? "provider-timeout" : "provider-cancelled", "Expression assistance did not complete.", timedOut);
  const checkActive = () => { if (controller.signal.aborted) throw cancellationError(); };
  const abort = () => controller.abort();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  if (dependencies.signal?.aborted) abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  let rejectCancelled!: () => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = () => reject(cancellationError()); });
  controller.signal.addEventListener("abort", rejectCancelled, { once: true });
  if (controller.signal.aborted) rejectCancelled();
  async function perform() {
    checkActive();
    const catalog = findConversationCharacter(input.characterKey);
    if (!catalog || catalog.version !== command.characterVersion) throw new ExpressionAssistError("CHARACTER_UNAVAILABLE", 404);
    // Also enforce the authored release/capability gate, without loading canon or memory.
    const definition = findCharacterRuntimeDefinition(input.characterKey, command.characterVersion);
    if (!definition || !isCharacterConversationEnabled(definition)) throw new ExpressionAssistError("CHARACTER_UNAVAILABLE", 404);
    if (!dependencies.repository) {
      if (!dependencies.allowStaticFallback || !isConversationStaticFallbackAllowed()) throw new ExpressionAssistError("CONVERSATION_UNAVAILABLE", 503);
    } else {
      let currentVersion: number | null;
      try { currentVersion = await dependencies.repository.getCurrentPublishedVersion(input.characterKey); }
      catch { throw new ExpressionAssistError("CONVERSATION_UNAVAILABLE", 503); }
      checkActive();
      if (currentVersion !== command.characterVersion) throw new ExpressionAssistError("CHARACTER_UNAVAILABLE", 404);
      let status: string;
      try { status = await dependencies.getContactStatus?.(input.userId, input.characterKey) ?? "unavailable"; }
      catch { throw new ExpressionAssistError("CONTACT_UNAVAILABLE", 503); }
      checkActive();
      if (status !== "active") throw new ExpressionAssistError(status === "unavailable" ? "CONTACT_UNAVAILABLE" : "CONTACT_REQUIRED", status === "unavailable" ? 503 : 403);
    }
    let context;
    try { context = dependencies.repository ? await dependencies.repository.listContext(input.userId, input.characterKey) : []; }
    catch { throw new ExpressionAssistError("CONVERSATION_UNAVAILABLE", 503); }
    checkActive();
    const safeContext = context.slice(-6).map((message) => ({ role: message.role, text: message.text.slice(0, 2_000) }));
    async function produce(signal: AbortSignal) {
      const startedAt = Date.now();
      try {
        const raw = await dependencies.provider.translate({ text: command.text, sourceLocale: "zh-CN", targetLocale: "es-ES", context: safeContext }, { signal });
        if (signal.aborted) throw new TranslationError("provider-cancelled", "Expression assistance did not complete.", false);
        const result = providerResultSchema.safeParse(raw);
        if (!result.success) throw new TranslationError("provider-response-invalid", "Expression assistance response was invalid.", false);
        observe(dependencies, { provider: result.data.provider, modelVersion: result.data.modelVersion, providerRequestId: result.data.providerRequestId, latencyMs: result.data.latencyMs, estimatedCostMicros: result.data.estimatedCostMicros, status: "succeeded" });
        return result.data;
      } catch (error) {
        observe(dependencies, { provider: "minimax", modelVersion: DEFAULT_MINIMAX_TEXT_MODEL, providerRequestId: null, latencyMs: Date.now() - startedAt, estimatedCostMicros: null, status: signal.aborted ? "cancelled" : "failed", errorType: error instanceof TranslationError ? error.code : "provider-unavailable" });
        throw error;
      }
    }
    return dependencies.attempts
      ? dependencies.attempts.run({ ...command, userId: input.userId, characterKey: input.characterKey }, produce, controller.signal)
      : produce(controller.signal);
  }
  try {
    const result = await Promise.race([perform(), cancelled]);
    checkActive();
    return expressionAssistDataSchema.parse({ text: result.text, attemptId: command.attemptId });
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectCancelled);
  }
}
