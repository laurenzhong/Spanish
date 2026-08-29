import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createMiniMaxConversationProvider,
  createOpenAIConversationProvider,
  type ConversationProviderInput,
  type ConversationProviderResult,
} from "../src/modules/providers/conversation/server";

type ReplayCase = Readonly<{
  caseId: string;
  category: string;
  dailyState: string;
  relationshipStage: string;
  userMessage: string;
  responseActPlan: string;
  questionBudget: number;
  intensityCeiling: number;
  inputKind?: string;
  expectedOutputStatus?: string;
}>;

type ProviderName = "minimax" | "openai";

type Result = Readonly<{
  caseId: string;
  category: string;
  inputKind: string;
  expectedOutputStatus: string;
  provider: ProviderName;
  status: "succeeded" | "failed" | "skipped";
  modelVersion: string | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  text: string | null;
  errorCode: string | null;
}>;

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "evaluation", "lucia-provider-v1");
const outputRoot = path.join(process.cwd(), "tmp", "evaluation", "lucia-provider-v1");

const character = {
  characterKey: "lucia" as const,
  characterVersion: 1,
  displayName: "Lucía Martín",
  homeLocation: "Madrid",
  initiative: "balanced" as const,
  tone: ["cercana", "natural", "con humor suave"],
  topics: ["fotografía urbana", "Madrid", "cafés", "música"],
  facts: [{
    factKey: "boundary.ai-identity",
    statement: "Soy un personaje de IA.",
    sensitivity: "normal" as const,
    reveal: "direct" as const,
  }],
};

function buildInput(item: ReplayCase): ConversationProviderInput {
  const relationshipStage = item.relationshipStage === "romantic_interest"
    ? "close_friend"
    : item.relationshipStage as ConversationProviderInput["relationshipStage"];
  return {
    userMessage: item.userMessage,
    recentMessages: [],
    character,
    relationshipStage,
    relationshipSummary: [
      `Evaluation relationship stage: ${item.relationshipStage}.`,
      `Daily state: ${item.dailyState}.`,
      `Response act: ${item.responseActPlan}.`,
      `Question budget: ${item.questionBudget}.`,
      `Intensity ceiling: ${item.intensityCeiling}.`,
    ].join(" "),
    memories: [],
    teachingOpportunity: null,
  };
}

async function runOne(
  provider: ProviderName,
  item: ReplayCase,
  generate: (input: ConversationProviderInput) => Promise<ConversationProviderResult>,
): Promise<Result> {
  const inputKind = item.inputKind ?? "user-message";
  const expectedOutputStatus = item.expectedOutputStatus ?? "reply";
  if (inputKind === "proactive-message" || expectedOutputStatus === "no-reply") {
    return {
      caseId: item.caseId,
      category: item.category,
      inputKind,
      expectedOutputStatus,
      provider,
      status: "skipped",
      modelVersion: null,
      latencyMs: null,
      providerRequestId: null,
      text: null,
      errorCode: inputKind === "proactive-message" ? "proactive-path-not-in-provider-contract" : "failure-injection-not-run",
    };
  }

  try {
    const result = await generate(buildInput(item));
    return {
      caseId: item.caseId,
      category: item.category,
      inputKind,
      expectedOutputStatus,
      provider,
      status: "succeeded",
      modelVersion: result.modelVersion,
      latencyMs: result.latencyMs,
      providerRequestId: result.providerRequestId,
      text: result.text,
      errorCode: null,
    };
  } catch (error) {
    return {
      caseId: item.caseId,
      category: item.category,
      inputKind,
      expectedOutputStatus,
      provider,
      status: "failed",
      modelVersion: null,
      latencyMs: null,
      providerRequestId: null,
      text: null,
      errorCode: error instanceof Error && "code" in error ? String(error.code) : "provider-unavailable",
    };
  }
}

async function main(): Promise<void> {
  if (!process.env.MINIMAX_API_KEY?.trim() || !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("Both MINIMAX_API_KEY and OPENAI_API_KEY must be configured.");
  }
  const cases = JSON.parse(await readFile(path.join(fixtureRoot, "cases.json"), "utf8")) as ReplayCase[];
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length))) : cases.length;
  const selectedCases = cases.slice(0, Number.isFinite(limit) ? limit : cases.length);
  const minimax = createMiniMaxConversationProvider();
  const openai = createOpenAIConversationProvider();
  const results: Result[] = [];
  for (const item of selectedCases) {
    results.push(await runOne("minimax", item, (input) => minimax.generate(input)));
    results.push(await runOne("openai", item, (input) => openai.generate(input)));
    const pair = results.slice(-2);
    console.log(`${item.caseId}: minimax=${pair[0]?.status}${pair[0]?.latencyMs == null ? "" : `/${pair[0].latencyMs}ms`} openai=${pair[1]?.status}${pair[1]?.latencyMs == null ? "" : `/${pair[1].latencyMs}ms`}`);
  }
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, `run-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  await writeFile(outputPath, `${JSON.stringify({ evaluationSet: "lucia-provider-v1", generatedAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
  console.log(`results=${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Provider A/B replay failed.");
  process.exitCode = 1;
});
