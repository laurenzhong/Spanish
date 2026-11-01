import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveEvaluation } from "./archive";
import { desktopRoot } from "./cli";
import { fingerprint } from "./manifest";
import type { ProbeRecord } from "./quality-probe";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const primaryRoot = path.join(repoRoot, "artifacts/conversation-evaluations");
const backupRoot = desktopRoot();
const sourceRunId = process.env.CONV_EVAL_SOURCE_RUN_ID ?? "baseline-r04-20261027gatefix2";
const oldQualitySourceRunId = process.env.CONV_EVAL_OLD_SOURCE_RUN_ID ?? "quality-r04-gatefix2-source-20261027";
const runId = process.env.CONV_EVAL_QUALITY_SOURCE_RUN_ID ?? "quality-r04-gatefix2-source-20261028";
const casePrefix = process.env.CONV_EVAL_CASE_PREFIX ?? runId.replace(/^quality-/u, "").replace(/-source-[0-9]+$/u, "");

if (!/^baseline-r04-[a-z0-9-]+$/u.test(sourceRunId)
  || !/^quality-r04-[a-z0-9-]+$/u.test(runId)
  || !/^quality-r04-[a-z0-9-]+$/u.test(oldQualitySourceRunId)) {
  throw new Error("R04_QUALITY_SOURCE_ID_INVALID");
}

type Baseline = Readonly<{ checkpoint: Readonly<{ sandbox: Readonly<{ messages: readonly Message[] }> }> }>;
type Message = Readonly<{ id: string; role: "user" | "character"; content: string; createdAt: string; status: string; generationId: string }>;
type QualitySource = Readonly<{ records: readonly ProbeRecord[] }>;

const baseline = JSON.parse(await readFile(path.join(primaryRoot, sourceRunId, "r04", "回放数据.json"), "utf8")) as Baseline;
const oldSource = JSON.parse(await readFile(path.join(primaryRoot, oldQualitySourceRunId, "batch-summary", "回放数据.json"), "utf8")) as QualitySource;
const messages = baseline.checkpoint.sandbox.messages;
const userMessages = messages.filter((message) => message.role === "user" && message.generationId.startsWith("r04-generation-"));
if (userMessages.length !== 24 || oldSource.records.length !== 24) throw new Error("R04_QUALITY_SOURCE_SHAPE_INVALID");

const records: ProbeRecord[] = userMessages.map((user, index) => {
  const candidate = messages.find((message) => message.id === `${user.generationId}-character` && message.role === "character");
  const previousMessages = messages.slice(0, messages.indexOf(user))
    .filter((message) => message.status === "completed" && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content, sentAt: message.createdAt }));
  if (!candidate) throw new Error("R04_QUALITY_CANDIDATE_MISSING");
  const previous = oldSource.records[index]!;
  const context = {
    ...previous.context,
    generationId: `quality-r04-gatefix2-clean-${index}`,
    userMessage: user.content,
    recentMessages: previousMessages,
  };
  return {
    ...previous,
    ordinal: index,
    caseId: `${casePrefix}-step-${user.generationId.slice("r04-generation-".length)}`,
    context,
    text: candidate.content,
    requestHash: null,
    systemHash: null,
    inputHash: null,
    gatePassed: true,
    latencyMs: 0,
    errorCode: null,
  };
});

const replay = {
  runId,
  provenance: {
    sourceRunId,
    sourceTrajectoryId: "r04",
    sourceMessageOrder: "checkpoint.sandbox.messages array order",
    excludesCurrentUserAndCharacter: true,
    generatedAt: new Date().toISOString(),
    sourceHash: fingerprint(messages),
    correction: "Do not use createdAt <= current user.createdAt; same-timestamp user/character pairs would include the current candidate.",
  },
  records,
};
const report = [
  `# 干净语言质量来源 ${runId}`,
  "",
  `来源：${sourceRunId}/r04；模型：MiniMax-M3.1-Flash/product。`,
  `候选：${records.length} 条普通用户回合最终角色回复。`,
  "recentMessages 按 sandbox.messages 数组顺序截取当前 user 之前的已完成消息，并排除当前 user 与其对应 character 回复；不按 createdAt 比较。",
  "旧来源 quality-r04-gatefix2-source-20261027 保持不变，仅保留作历史审计。",
].join("\n");
const result = await archiveEvaluation({
  primaryRoot,
  backupRoot,
  input: {
    runId,
    trajectoryId: "batch-summary",
    transcriptMarkdown: report,
    summaryMarkdown: report,
    replay,
    messageCount: records.reduce((sum, record) => sum + record.context.recentMessages.length + 2, 0),
    turnCount: records.length,
  },
});
if (result.status !== "complete") throw new Error(`QUALITY_SOURCE_ARCHIVE_${result.status.toUpperCase()}`);
console.log(JSON.stringify({ runId, sourceRunId, records: records.length, archive: result }, null, 2));
