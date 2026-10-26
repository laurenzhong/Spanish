import path from "node:path";
import { readFile } from "node:fs/promises";
import { archiveEvaluation } from "./archive";
import { desktopRoot } from "./cli";
import { fingerprint, safeId } from "./manifest";
import { createPaidTransport, type PaidLedger } from "./paid-transport";
import { createCheckpointStore } from "./store";
import { combineLanguageQualityReviews, reviewLanguageQuality, type LanguageQualityReview, type LanguageQualityReviewInput } from "./language-quality";
import { createMiniMaxLanguageQualityReviewer } from "./language-quality-provider";
import type { ProbeRecord } from "./quality-probe";

type SourceReplay = Readonly<{ runId: string; records: readonly ProbeRecord[] }>;
type ReviewAttempt = Readonly<{ sampleOrdinal: number; reviewer: 0 | 1; review: LanguageQualityReview | null; errorCode: string | null }>;
type State = {
  version: 1; runId: string; sourceRunId: string; createdAt: string; sourceHash: string;
  selected: ProbeRecord[]; attempts: ReviewAttempt[]; ledger: PaidLedger | null;
  status: "running" | "completed" | "interrupted"; error: string | null; primaryRoot: string; backupRoot: string;
};

export function parseLanguageQualityArgs(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(execute|export-only)$/u.exec(arg) ?? /^--(run-id|source-run-id|limit)=(.+)$/u.exec(arg);
    if (!match || values.has(match[1])) throw new Error("INVALID_LANGUAGE_QUALITY_OPTIONS");
    values.set(match[1], match[2] ?? "true");
  }
  if (values.has("execute") === values.has("export-only")) throw new Error("EXECUTE_OR_EXPORT_REQUIRED");
  const runId = safeId.parse(values.get("run-id"));
  const sourceRunId = safeId.parse(values.get("source-run-id"));
  if (!runId.startsWith("language-quality-") || !sourceRunId.startsWith("quality-")) throw new Error("LANGUAGE_QUALITY_ID_REQUIRED");
  const limit = Number(values.get("limit") ?? "3");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw new Error("LANGUAGE_QUALITY_LIMIT_INVALID");
  return { runId, sourceRunId, limit, exportOnly: values.has("export-only") };
}

const quote = (text: string) => text.split(/\r?\n/u).map((line) => `> ${line}`).join("\n");
const safeError = (error: unknown) => error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "LANGUAGE_REVIEW_FAILED";
const inputFromRecord = (record: ProbeRecord): LanguageQualityReviewInput => ({
  caseId: `${record.caseId}/${record.variantId}/${record.repetition}`,
  userMessage: record.context.userMessage,
  recentMessages: record.context.recentMessages.map(({ role, content }) => ({ role, content })),
  candidate: record.text ?? "",
});

export async function runLanguageQualityBatch(options: ReturnType<typeof parseLanguageQualityArgs> & {
  repoRoot: string; apiKey?: string; signal?: AbortSignal; primaryRoot?: string; backupRoot?: string;
  fetchImplementation?: typeof fetch; onProgress?: (value: { completed: number; planned: number; status: string }) => void;
}) {
  if (process.env.NODE_ENV === "production") throw new Error("LANGUAGE_QUALITY_REFUSES_PRODUCTION");
  const primaryRoot = path.resolve(options.primaryRoot ?? path.join(options.repoRoot, "artifacts/conversation-evaluations"));
  const backupRoot = path.resolve(options.backupRoot ?? desktopRoot());
  const store = createCheckpointStore(primaryRoot, options.runId, "language-quality");
  return store.exclusive(async () => {
    const previous = await store.load() as State | undefined;
    if (previous && !options.exportOnly) throw new Error("LANGUAGE_QUALITY_RUN_EXISTS_EXPORT_ONLY");
    const sourcePath = path.join(primaryRoot, options.sourceRunId, "batch-summary", "回放数据.json");
    let source: SourceReplay;
    try { source = JSON.parse(await readFile(sourcePath, "utf8")) as SourceReplay; } catch { throw new Error("LANGUAGE_QUALITY_SOURCE_NOT_FOUND"); }
    const selected = previous?.selected ?? source.records.filter((record) => typeof record.text === "string" && record.text.trim()).slice(0, options.limit);
    if (selected.length !== options.limit) throw new Error("LANGUAGE_QUALITY_SOURCE_TOO_SHORT");
    const state: State = previous ?? { version: 1, runId: options.runId, sourceRunId: options.sourceRunId, createdAt: new Date().toISOString(),
      sourceHash: fingerprint(source.records), selected: [...selected], attempts: [], ledger: null, status: "running", error: null, primaryRoot, backupRoot };
    if (state.runId !== options.runId || state.sourceRunId !== options.sourceRunId || state.primaryRoot !== primaryRoot || state.backupRoot !== backupRoot
      || fingerprint(state.selected) !== fingerprint(selected)) throw new Error("LANGUAGE_QUALITY_STATE_MISMATCH");
    const planned = state.selected.length * 2;
    const archiveSample = async (record: ProbeRecord, attempts: readonly ReviewAttempt[]) => {
      const input = inputFromRecord(record);
      const combined = attempts.length === 2 && attempts.every((attempt) => attempt.review) ? combineLanguageQualityReviews(attempts.map((attempt) => attempt.review!) ) : null;
      const transcript = [`# 独立语言质量评审 ${record.caseId}/${record.variantId}/${record.repetition}`, `来源批次：${state.sourceRunId}；模型：${record.modelVersion ?? "MiniMax-M3.1-Flash"}`, "", "## 当前用户", "", quote(input.userMessage), "", "## 角色候选（逐字可见）", "", quote(input.candidate)].join("\n");
      const summary = [`# 独立语言质量问题总结`, `样本：${input.caseId}`, `评审状态：${combined?.gate ?? "inconclusive"}`, `接受性：${combined?.acceptability ?? "not-sendable"}`, "", "## Findings", "", ...(combined?.findings.length ? combined.findings.map((finding) => `- ${finding.severity} / ${finding.category}：${quote(finding.quote)}；${finding.issue}`) : ["无可核验 finding；不代表不存在问题。"]), "", "## 限制", "", "- 此评审只评价可见候选语言质量，不改写候选、关系状态或人物设定。", "- 评审模型不是真人语言审核；收费响应、失败和未知计费均以回放账本为准。"].join("\n");
      return archiveEvaluation({ primaryRoot, backupRoot: state.backupRoot, input: { runId: state.runId, trajectoryId: `sample-${String(record.ordinal).padStart(3, "0")}`,
        transcriptMarkdown: transcript, summaryMarkdown: summary, replay: { sourceRunId: state.sourceRunId, sourceRecord: record, attempts, combined }, messageCount: input.recentMessages.length + 2, turnCount: 1 } });
    };
    const archiveAll = async () => { for (const record of state.selected) { const attempts = state.attempts.filter((attempt) => attempt.sampleOrdinal === record.ordinal); if (attempts.length === 2) { const result = await archiveSample(record, attempts); if (result.status !== "complete") throw new Error("LANGUAGE_QUALITY_ARCHIVE_INCOMPLETE"); } } };
    if (!options.exportOnly) {
      if (!options.apiKey?.trim()) throw new Error("REAL_PROVIDER_KEY_REQUIRED");
      await store.save(state);
      const abort = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
      const transport = createPaidTransport({ apiKey: options.apiKey, signal, fetchImplementation: options.fetchImplementation,
        persist: async (ledger) => { state.ledger = ledger; await store.save(state); } });
      const reviewer = createMiniMaxLanguageQualityReviewer(async (request) => transport.execute({ ...request, scope: { trajectoryId: "language-quality", step: state.attempts.length } }));
      try {
        for (const record of state.selected) {
          const input = inputFromRecord(record);
          for (const reviewerIndex of [0, 1] as const) {
            if (state.attempts.some((attempt) => attempt.sampleOrdinal === record.ordinal && attempt.reviewer === reviewerIndex)) continue;
            let review: LanguageQualityReview | null = null; let errorCode: string | null = null;
            try { review = await reviewLanguageQuality(input, reviewer, signal); } catch (error) { errorCode = safeError(error); }
            state.attempts.push({ sampleOrdinal: record.ordinal, reviewer: reviewerIndex, review, errorCode }); await store.save(state);
            options.onProgress?.({ completed: state.attempts.length, planned, status: errorCode ?? review?.gate ?? "reviewed" });
            const blockedReason = transport.snapshot().blockedReason;
            if (blockedReason) { abort.abort(); throw new Error(blockedReason); }
          }
        }
        state.status = state.attempts.length === planned ? "completed" : "interrupted";
      } catch { state.status = "interrupted"; state.error ??= "LANGUAGE_QUALITY_EXECUTION_INTERRUPTED"; }
      state.ledger = transport.snapshot(); state.error ??= state.ledger.blockedReason; await store.save(state);
    }
    await archiveAll();
    const rows = state.selected.map((record) => {
      const attempts = state.attempts.filter((attempt) => attempt.sampleOrdinal === record.ordinal);
      const combined = attempts.length === 2 && attempts.every((attempt) => attempt.review) ? combineLanguageQualityReviews(attempts.map((attempt) => attempt.review!) ) : null;
      return `| ${record.caseId}/${record.variantId}/${record.repetition} | ${combined?.gate ?? "inconclusive"} | ${combined?.findings.length ?? "—"} | ${attempts.filter((attempt) => attempt.errorCode).length} |`;
    });
    const report = ["# 独立语言质量诊断", `批次 ${state.runId}；来源 ${state.sourceRunId}；${state.status}；${state.attempts.length}/${planned} 次评审。`, "模型：MiniMax-M3.1-Flash；每个候选两次独立评审。", "固定门槛：0 critical、0 major、minor≤2；不一致/证据不足=inconclusive。", "", "| 样本 | 门禁 | finding 数 | 评审错误 |", "|---|---|---:|---:|", ...rows, "", `已知 usage ¥${(state.ledger?.entries.reduce((sum, entry) => sum + (entry.measuredCostMicros ?? 0), 0) ?? 0) / 1e6}；未知计费 ${state.ledger?.entries.filter((entry) => entry.measuredCostMicros === null && entry.status !== "not_sent").length ?? 0}；错误 ${state.error ?? "无"}。`, "此报告只记录语言质量协议结果，不回写人物、关系或历史质量批次。"].join("\n");
    const archive = await archiveEvaluation({ primaryRoot, backupRoot: state.backupRoot, input: { runId: state.runId, trajectoryId: "batch-summary", transcriptMarkdown: report, summaryMarkdown: report, replay: state, messageCount: state.selected.length * 2, turnCount: state.selected.length } });
    return { runId: state.runId, sourceRunId: state.sourceRunId, status: state.status, planned, count: state.attempts.length, archive, error: state.error };
  });
}

