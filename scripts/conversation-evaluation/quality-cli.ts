import path from "node:path";
import { readFile } from "node:fs/promises";
import { archiveEvaluation } from "./archive";
import { desktopRoot, evaluationSourceFingerprint } from "./cli";
import { fingerprint, safeId } from "./manifest";
import { createPaidTransport, type PaidLedger } from "./paid-transport";
import { qualityCases, qualityVariants } from "./quality-cases";
import { runQualityProbe, type ProbeRecord, type ProbeVariant, type ProbeCase } from "./quality-probe";
import { createCheckpointStore } from "./store";

type State = {
  version: 1 | 2 | 3; runId: string; phase: "diagnostic" | "holdout"; createdAt: string;
  experiment?: "models";
  transportPolicy?: { modelPolicy: "flash-m3-v1"; ceilingMicros: number };
  source: Awaited<ReturnType<typeof evaluationSourceFingerprint>>;
  cases: ProbeCase[]; variants: ProbeVariant[]; repetitions: number;
  records: ProbeRecord[]; ledger: PaidLedger | null; status: "running" | "completed" | "interrupted"; error: string | null;
  primaryRoot: string; backupRoot: string;
};
const modelVariants: ProbeVariant[] = [
  { id: "full-flash-max", effort: "max", modelVersion: "MiniMax-M3.1-Flash" },
  { id: "full-m3-native", effort: "native", modelVersion: "MiniMax-M3" },
];
const modelTransportPolicy = { modelPolicy: "flash-m3-v1" as const, ceilingMicros: 1_534_632 };

async function qualitySourceFingerprint(repoRoot: string, models: boolean): Promise<State["source"]> {
  const original = await evaluationSourceFingerprint(repoRoot);
  if (!models) return original;
  const file = "scripts/run-conversation-quality.ts";
  const sources = [...original.sources, { file, hash: fingerprint(await readFile(path.join(repoRoot, file), "utf8")) }]
    .sort((left, right) => left.file.localeCompare(right.file));
  return { sources, hash: fingerprint(sources) };
}

export function parseQualityArgs(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(execute|export-only)$/u.exec(arg) ?? /^--(run-id|phase|candidate|experiment)=(.+)$/u.exec(arg);
    if (!match || values.has(match[1])) throw new Error("INVALID_QUALITY_OPTIONS");
    values.set(match[1], match[2] ?? "true");
  }
  if (values.has("execute") === values.has("export-only")) throw new Error("EXECUTE_OR_EXPORT_REQUIRED");
  const runId = safeId.parse(values.get("run-id"));
  if (!runId.startsWith("quality-")) throw new Error("QUALITY_ID_REQUIRED");
  const phase = values.get("phase") ?? "diagnostic";
  if (phase !== "diagnostic" && phase !== "holdout") throw new Error("QUALITY_PHASE_INVALID");
  const candidate = values.get("candidate");
  const experiment = values.get("experiment") ?? "prompts";
  if (experiment !== "prompts" && experiment !== "models") throw new Error("QUALITY_EXPERIMENT_INVALID");
  if (phase === "holdout" && !values.has("export-only") && (experiment === "models"
    ? candidate !== "full-m3-native"
    : !candidate || candidate === "full-max" || !qualityVariants.some(v => v.id === candidate))) throw new Error("QUALITY_CANDIDATE_REQUIRED");
  if (phase === "diagnostic" && candidate) throw new Error("QUALITY_CANDIDATE_NOT_APPLICABLE");
  return { runId, phase: phase as State["phase"], experiment, candidate, exportOnly: values.has("export-only") };
}
const quote = (text: string) => text.split(/\r?\n/u).map(line => `> ${line}`).join("\n");
export async function runQualityBatch(options: ReturnType<typeof parseQualityArgs> & {
  repoRoot: string; apiKey?: string; signal?: AbortSignal; primaryRoot?: string; backupRoot?: string;
  fetchImplementation?: typeof fetch; onProgress?: (value: { count: number; planned: number; status: string }) => void;
}) {
  if (process.env.NODE_ENV === "production") throw new Error("QUALITY_REFUSES_PRODUCTION");
  const primaryRoot = path.resolve(options.primaryRoot ?? path.join(options.repoRoot, "artifacts/conversation-evaluations"));
  const store = createCheckpointStore(primaryRoot, options.runId, "quality-batch");
  return store.exclusive(async () => {
    const previous = await store.load() as State | undefined;
    if (previous && !options.exportOnly) throw new Error("QUALITY_RUN_EXISTS_EXPORT_ONLY");
    if (!previous && options.exportOnly) throw new Error("QUALITY_RUN_NOT_FOUND");
    const state: State = previous ?? {
      version: options.experiment === "models" ? 3 : 2, runId: options.runId, phase: options.phase, createdAt: new Date().toISOString(),
      ...(options.experiment === "models" ? { experiment: "models" as const, transportPolicy: { ...modelTransportPolicy } } : {}),
      source: await qualitySourceFingerprint(options.repoRoot, options.experiment === "models"),
      cases: qualityCases.filter(c => c.split === options.phase),
      variants: options.experiment === "models" ? modelVariants.map(variant => ({ ...variant }))
        : options.phase === "diagnostic" ? qualityVariants : qualityVariants.filter(v => v.id === "full-max" || v.id === options.candidate),
      repetitions: 2, records: [], ledger: null, status: "running", error: null,
      primaryRoot, backupRoot: path.resolve(options.backupRoot ?? desktopRoot()),
    };
    if (state.runId !== options.runId || state.primaryRoot !== primaryRoot) throw new Error("QUALITY_STATE_MISMATCH");
    if (state.version === 3 && (state.experiment !== "models" || !state.transportPolicy || fingerprint(state.transportPolicy) !== fingerprint(modelTransportPolicy)
      || fingerprint(state.variants) !== fingerprint(modelVariants))) throw new Error("QUALITY_MODEL_STATE_MISMATCH");
    const planned = state.cases.length * state.variants.length * state.repetitions;
    const archiveRecord = async (record: ProbeRecord) => {
      const sampleId = `sample-${String(record.ordinal).padStart(3, "0")}`;
      const transcript = [`# 单轮合成探针 ${sampleId}`, "不是完整聊天轨迹；历史为固定合成输入，不代表新生成或真实经历。",
        `运行：${state.runId}；case：${record.caseId}；组：${record.variantId}；重复：${record.repetition}`, "",
        ...(state.version === 3 ? [`模型：${record.modelVersion}；实际请求配置：${JSON.stringify(record.requestConfiguration)}`] : []),
        ...record.context.recentMessages.map(m => `## 固定历史 · ${m.role}\n\n${quote(m.content)}`),
        `## 当前用户\n\n${quote(record.context.userMessage)}`, `## 模型首个候选\n\n${quote(record.text ?? "（生成失败，无可用正文）")}`].join("\n\n");
      const summary = [`# 单轮探针问题总结`, `case ${record.caseId} / ${record.variantId} / repetition ${record.repetition}`,
        ...(state.version === 3 ? [`模型：${record.modelVersion}；实际请求配置：${JSON.stringify(record.requestConfiguration)}`] : []),
        `产品门禁接受首答：${record.gatePassed}；生成错误：${record.errorCode ?? "无"}；污染标记：${record.flags.contamination}；英语片段：${record.flags.englishFragments.join(", ") || "未命中有限词表"}`,
        "门禁接受不代表自然西语正确；语义质量须逐字复核。无真实记忆写入、关系推进或产品安全重试。", `延迟：${record.latencyMs} ms；完整计费证据见批次账本。`].join("\n\n");
      const result = await archiveEvaluation({ primaryRoot, backupRoot: state.backupRoot, input: { runId: state.runId, trajectoryId: sampleId,
        transcriptMarkdown: transcript, summaryMarkdown: summary, replay: record, messageCount: record.context.recentMessages.length + 1 + (record.text ? 1 : 0), turnCount: 1 } });
      if (result.status !== "complete") throw new Error("QUALITY_ARCHIVE_INCOMPLETE");
    };
    if (!options.exportOnly) {
      if (!options.apiKey?.trim()) throw new Error("REAL_PROVIDER_KEY_REQUIRED");
      await store.save(state);
      const abort = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
      const transport = createPaidTransport({ apiKey: options.apiKey, signal, fetchImplementation: options.fetchImplementation,
        ...(state.version === 3 ? state.transportPolicy : {}),
        persist: async ledger => { state.ledger = ledger; await store.save(state); } });
      try {
        await runQualityProbe({ apiKey: options.apiKey, cases: state.cases, variants: state.variants, repetitions: state.repetitions, signal,
          execute: async request => {
            try { return await transport.execute({ ...request, scope: { trajectoryId: "quality-probe", step: state.records.length } }); }
            finally { if (transport.snapshot().blockedReason) abort.abort(); }
          }, persist: async record => {
            state.records.push(record); await store.save(state); await archiveRecord(record);
            options.onProgress?.({ count: state.records.length, planned, status: record.errorCode ?? "returned" });
          } });
        state.status = state.records.length === planned ? "completed" : "interrupted";
      } catch { state.status = "interrupted"; state.error = "QUALITY_EXECUTION_INTERRUPTED"; }
      state.ledger = transport.snapshot();
      state.error ??= state.ledger.blockedReason;
      await store.save(state);
    }
    for (const record of state.records) await archiveRecord(record);
    const table = state.variants.map(v => {
      const records = state.records.filter(r => r.variantId === v.id);
      return { variant: v.id, calls: records.length, accepted: records.filter(r => r.gatePassed).length,
        contamination: records.filter(r => r.flags.contamination).length, english: records.filter(r => r.flags.englishFragments.length).length,
        errors: records.filter(r => r.errorCode).length };
    });
    const knownCostMicros = state.ledger?.entries.reduce((s,e) => s + (e.measuredCostMicros ?? 0), 0) ?? 0;
    const unknownCostCalls = state.ledger?.entries.filter(e => e.measuredCostMicros === null && e.status !== "not_sent").length ?? 0;
    const report = ["# 生成质量配对探针", `批次 ${state.runId}；${state.phase}；${state.status}；${state.records.length}/${planned}。`,
      ...(state.version === 3 ? ["模型对照：完整系统指令与用户输入固定；Flash 使用 max/4896 总输出，M3 使用原生 disabled thinking/800 输出。模型和原生配置同时变化，不是纯参数单变量实验。",
        `冻结模型策略：${JSON.stringify(state.transportPolicy)}；${state.variants.map(variant => `${variant.id}=${variant.modelVersion}/${variant.effort}`).join("；")}。`] : []),
      "实验为独立单轮首答；不含模型评审，也不代表完整对话、自然度或关系验收。",
      "| 配置 | 记录 | 门禁接受 | 污染 | 英语命中 | 生成错误 |", "|---|---:|---:|---:|---:|---:|",
      ...table.map(r => `| ${r.variant} | ${r.calls} | ${r.accepted} | ${r.contamination} | ${r.english} | ${r.errors} |`),
      state.version === 1
        ? `实际 HTTP ${state.ledger?.entries.length ?? 0}；已知 usage ¥${knownCostMicros / 1e6}；预留 ¥${(state.ledger?.reservedCostMicros ?? 0) / 1e6}；错误 ${state.error ?? "无"}。`
        : `调用预留 ${state.ledger?.entries.length ?? 0}；收到响应 ${state.ledger?.entries.filter(e => e.status === "received").length ?? 0}；未知计费 ${unknownCostCalls}；已知 usage ¥${knownCostMicros / 1e6}；预留 ¥${(state.ledger?.reservedCostMicros ?? 0) / 1e6}；错误 ${state.error ?? "无"}。`,
      ...(state.version !== 1 ? ["污染列仅为结构/规划标记，不涵盖全部混合语言；英语列为有限词表命中，须逐字复核。"] : []),
      `源指纹 ${state.source.hash}；冻结 cases/variants 指纹 ${fingerprint({ cases: state.cases, variants: state.variants })}。`,
      ...state.records.map(r => `- [${r.caseId} / ${r.variantId} / ${r.repetition}](../sample-${String(r.ordinal).padStart(3, "0")}/聊天记录.md)`),
    ].join("\n\n");
    const archive = await archiveEvaluation({ primaryRoot, backupRoot: state.backupRoot, input: { runId: state.runId, trajectoryId: "batch-summary",
      transcriptMarkdown: report, summaryMarkdown: report, replay: state,
      // Keep old immutable archive bytes; v1 count correction is documented in the audit supplement.
      messageCount: state.version === 1 ? state.records.length * 2 : state.records.reduce((sum, r) => sum + r.context.recentMessages.length + 1 + (r.text ? 1 : 0), 0), turnCount: state.records.length } });
    return { runId: state.runId, status: state.status, planned, count: state.records.length, table, knownCostMicros, archive };
  });
}
