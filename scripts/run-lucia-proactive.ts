import "dotenv/config";

import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { generateLuciaProactiveMessage, createDrizzleProactiveMessageRepository, resolveConversationCharacter, getConversationCharacter } from "../src/modules/conversation";
import { createDrizzleCharacterRepository } from "../src/modules/characters";
import { formatNaturalDate, getDueLuciaProactiveSlots, parseLuciaProactiveUserIds, proactiveFailurePayload, scheduledProactiveDatabaseUrl } from "../src/modules/conversation/application/proactive-runner-utils";
import { createDrizzleMemoryRepository } from "../src/modules/memory";
import { createMiniMaxConversationProvider } from "../src/modules/providers/conversation/minimax-conversation";
import { createOpenAIConversationProvider } from "../src/modules/providers/conversation/openai-conversation";
import { createDatabaseConnection } from "../src/shared/db/client";

export { formatNaturalDate, parseLuciaProactiveUserIds } from "../src/modules/conversation/application/proactive-runner-utils";

export type LuciaProactiveRunResult = Readonly<{
  date: string;
  generated: number;
  suppressed: number;
  failed: number;
  results: readonly Readonly<{ userId: string; status: string; reason: string | null; messageId: string | null }>[];
}>;

export async function runLuciaProactiveDaily(now = new Date()): Promise<LuciaProactiveRunResult> {
  const userIds = parseLuciaProactiveUserIds();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\/[^\s]+$/u.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL connection string.");

  // Disable postgres.js's internal array-type fetch; see
  // scheduledProactiveDatabaseUrl for the 2026-10-22 scheduled-run failure it
  // prevents. The runner reads no array columns.
  const connection = createDatabaseConnection(scheduledProactiveDatabaseUrl(databaseUrl));
  try {
    const configuredProvider = process.env.CONVERSATION_PROVIDER?.trim().toLowerCase() || "deepseek";
    const useDeepSeek = configuredProvider === "deepseek" && process.env.OPENAI_API_KEY?.trim();
    const useOpenAI = configuredProvider === "openai" && process.env.OPENAI_API_KEY?.trim();
    const provider = useDeepSeek || useOpenAI
      ? createOpenAIConversationProvider({ providerName: useDeepSeek ? "deepseek" : "openai" })
      : process.env.MINIMAX_API_KEY?.trim()
        ? createMiniMaxConversationProvider()
        : undefined;
    if (!provider) throw new Error("A conversation provider API key is required.");
    const runtimeCharacter = await resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: getConversationCharacter("lucia").version,
      repository: createDrizzleCharacterRepository(connection.db),
      requiredCapability: "proactiveMessages",
    });

    const results: Array<LuciaProactiveRunResult["results"][number]> = [];
    for (const userId of userIds) {
      try {
        const memoryRepository = createDrizzleMemoryRepository(connection.db);
        const memories = await memoryRepository.listReadableMemories(userId, "lucia");
        const dueSlots = getDueLuciaProactiveSlots({ userId, now });
        for (const slot of dueSlots) {
          let result = await generateLuciaProactiveMessage({
            userId,
            source: "daily_share",
            sourceEventId: slot.sourceEventId,
            dailyState: slot.dailyState,
            now,
            repository: createDrizzleProactiveMessageRepository(connection.db),
            provider,
            character: runtimeCharacter.catalog.snapshot,
            memories,
          });
          for (let attempt = 1; attempt < 3 && result.status === "failed" && result.reason === "provider-unavailable"; attempt += 1) {
            result = await generateLuciaProactiveMessage({
              userId,
              source: "daily_share",
              sourceEventId: slot.sourceEventId,
              dailyState: slot.dailyState,
              now,
              repository: createDrizzleProactiveMessageRepository(connection.db),
              provider,
              character: runtimeCharacter.catalog.snapshot,
              memories,
            });
          }
          results.push({ userId, status: result.status, reason: result.reason ?? null, messageId: result.message?.id ?? result.candidate?.messageId ?? null });
        }
      } catch (error) {
        results.push({ userId, status: "failed", reason: error instanceof Error ? error.message : "PROACTIVE_FAILED", messageId: null });
      }
    }
    return {
      date: formatNaturalDate(now),
      generated: results.filter((result) => result.status === "generated").length,
      suppressed: results.filter((result) => result.status === "suppressed").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
  } finally {
    await connection.client.end();
  }
}

async function main(): Promise<void> {
  const result = await runLuciaProactiveDaily();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed > 0) process.exitCode = 1;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  // Process-level failures (for example a rejection from a library promise the
  // runner does not own) must still produce one actionable line and exit 1
  // instead of the raw "triggerUncaughtException" dump that made the
  // 2026-10-22 scheduled run hard to diagnose. Write synchronously so the line
  // survives the immediate exit.
  const reportFailure = (reason: string, error: unknown): never => {
    writeSync(2, `${proactiveFailurePayload(reason, error)}\n`);
    process.exit(1);
  };
  process.on("unhandledRejection", (reason: unknown) => reportFailure("unhandled-rejection", reason));
  process.on("uncaughtException", (error: unknown) => reportFailure("uncaught-exception", error));
  main().catch((error: unknown) => reportFailure("run-failed", error));
}
