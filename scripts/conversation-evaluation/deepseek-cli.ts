import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { archiveEvaluation } from "./archive";
import { desktopRoot, evaluationSourceFingerprint } from "./cli";
import { fingerprint, realManifestSchema, routeSchema, safeId, type EvaluationRoute } from "./manifest";
import { coreRoutes, makeOfflineManifest } from "./routes";
import { createDeepSeekPaidTransport, type DeepSeekPaidLedger } from "./deepseek-paid-transport";
import { createDeepSeekParticipants } from "./deepseek-provider";
import { restoreCheckpoint, runTrajectory, type EvaluationCheckpoint } from "./runner";
import { createCheckpointStore, renderReports } from "./store";

const ceiling = 7_562_784;
const batchSchema = z.object({ version: z.literal(1), mode: z.literal("deepseek"), runId: safeId,
  scope: z.literal("fixed-selected-core-v1"), createdAt: z.iso.datetime(), primaryRoot: z.string(), backupRoot: z.string(),
  source: z.object({ hash: z.string(), sources: z.array(z.object({ file: z.string(), hash: z.string() })) }),
  trajectories: z.array(z.object({ manifest: realManifestSchema, route: routeSchema })).min(1).max(3),
}).strict();

export function parseDeepSeekArgs(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const flag = /^--(execute|export-only|recover-locks)$/u.exec(arg);
    const value = /^--(run-id|resume|primary-root|backup-root|routes)=(.+)$/u.exec(arg);
    const key = flag?.[1] ?? value?.[1];
    if (!key || values.has(key)) throw new Error("INVALID_OR_DUPLICATE_OPTION");
    values.set(key, value?.[2] ?? "true");
  }
  if (values.has("execute") === values.has("export-only")) throw new Error("EXECUTE_OR_EXPORT_REQUIRED");
  if (values.has("run-id") && values.has("resume")) throw new Error("CONFLICTING_RUN_ID");
  if ((values.has("export-only") || values.has("recover-locks")) && !values.has("resume")) throw new Error("RESUME_REQUIRED");
  const runId = safeId.parse(values.get("resume") ?? values.get("run-id") ?? `baseline-deepseek-${new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
  if (!runId.startsWith("baseline-deepseek-")) throw new Error("DEEPSEEK_BASELINE_ID_REQUIRED");
  const routes = values.get("routes")?.split(",") ?? ["r01", "r05"];
  if (routes.length < 1 || routes.length > 3 || new Set(routes).size !== routes.length || routes.some((route) => !["r01", "r04", "r05"].includes(route))) throw new Error("DEEPSEEK_ROUTE_SELECTION_REQUIRED");
  return { runId, resume: values.has("resume"), exportOnly: values.has("export-only"), recoverLocks: values.has("recover-locks"), routes: routes as ("r01" | "r04" | "r05")[], primaryRoot: values.get("primary-root"), backupRoot: values.get("backup-root") };
}

export function makeDeepSeekManifest(runId: string, route: EvaluationRoute, codeFingerprint: string, safetyRetryLimit = 3) {
  const base = makeOfflineManifest({ runId, trajectoryId: route.routeId.toLowerCase(), route, codeFingerprint });
  const characterMaxCalls = route.steps.reduce((sum, step) => sum + (step.kind === "user" ? 1 + safetyRetryLimit : 2), 0);
  return realManifestSchema.parse({ ...base, schemaVersion: 2, mode: "real", maxCostMicros: ceiling, maxWallMs: 1800000,
    safetyRetryLimit, budgetScope: "selected-core-routes", authorization: "owner-continue-after-2026-10-25-budget-proposal",
    participants: { user: "scripted-user-v2", character: "DeepSeek/deepseek-flash/product", reviewer: "DeepSeek/deepseek-flash/reviewer-v1" },
    budget: { ...base.budget, user: { ...base.budget.user, maxReservedTokens: 0 }, character: { ...base.budget.character, maxCalls: characterMaxCalls, inputTokensPerCall: 32768, outputTokensPerCall: 4896, maxReservedTokens: characterMaxCalls * (32768 + 4896) }, reviewer: { ...base.budget.reviewer, maxCalls: 2, inputTokensPerCall: 64000, outputTokensPerCall: 12000, maxReservedTokens: 2 * (64000 + 12000) } },
  });
}

function billing(ledger: DeepSeekPaidLedger, trajectoryId: string) {
  const entries = ledger.entries.filter((entry) => entry.scope?.trajectoryId === trajectoryId);
  return { currency: "UNKNOWN", policyHash: ledger.hash, reservedCostMicros: entries.reduce((sum, entry) => sum + entry.reservedCostMicros, 0),
    measuredKnownCostMicros: 0, unknownCostCalls: entries.filter((entry) => entry.status !== "not_sent").length,
    note: "DeepSeek pricing is intentionally not inferred. reservedCostMicros is a conservative transport budget unit, not a currency amount; usage is recorded when returned.", entries };
}

export async function runDeepSeekBaseline(options: ReturnType<typeof parseDeepSeekArgs> & {
  repoRoot: string; apiKey?: string; signal?: AbortSignal; fetchImplementation?: typeof fetch;
}) {
  if (process.env.NODE_ENV === "production") throw new Error("EVALUATION_REFUSES_PRODUCTION");
  if (!options.exportOnly && !options.apiKey?.trim()) throw new Error("DEEPSEEK_API_KEY_REQUIRED");
  const primaryRoot = path.resolve(options.primaryRoot ?? path.join(options.repoRoot, "artifacts/conversation-evaluations"));
  const batchStore = createCheckpointStore(primaryRoot, options.runId, "batch-deepseek");
  if (options.recoverLocks) await batchStore.recoverAbandonedLock();
  return batchStore.exclusive(async () => {
    const previous = await batchStore.load();
    if (options.resume && !previous) throw new Error("RUN_NOT_FOUND");
    if (!options.resume && previous) throw new Error("RUN_EXISTS_USE_RESUME_OR_NEW_ID");
    const batch = previous ? batchSchema.parse(previous) : await (async () => {
      const source = await evaluationSourceFingerprint(options.repoRoot);
      const routes = options.routes.map((routeId) => coreRoutes.find((route) => route.routeId.toLowerCase() === routeId));
      if (routes.some((route): route is undefined => !route)) throw new Error("ROUTE_SET_UNAVAILABLE");
      const selected = routes as EvaluationRoute[];
      return batchSchema.parse({ version: 1, mode: "deepseek", scope: "fixed-selected-core-v1", runId: options.runId, createdAt: new Date().toISOString(), primaryRoot,
        backupRoot: path.resolve(options.backupRoot ?? desktopRoot()), source, trajectories: selected.map((route) => ({ route, manifest: makeDeepSeekManifest(options.runId, route, source.hash) })) });
    })();
    if (batch.runId !== options.runId || path.resolve(batch.primaryRoot) !== primaryRoot) throw new Error("BATCH_SCOPE_MISMATCH");
    if (options.backupRoot && path.resolve(options.backupRoot) !== path.resolve(batch.backupRoot)) throw new Error("BACKUP_ROOT_MISMATCH");
    const within = (a: string, b: string) => { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); };
    if (within(primaryRoot, batch.backupRoot) || within(batch.backupRoot, primaryRoot)) throw new Error("ARCHIVE_ROOTS_MUST_BE_SEPARATE");
    if (!previous) await batchStore.save(batch);
    const paidStore = createCheckpointStore(primaryRoot, batch.runId, "paid-ledger-deepseek");
    if (options.recoverLocks) await paidStore.recoverAbandonedLock();
    return paidStore.exclusive(async () => {
      const prior = await paidStore.load();
      if (options.exportOnly && !prior) throw new Error("DEEPSEEK_PAID_LEDGER_NOT_FOUND");
      const transport = createDeepSeekPaidTransport({ apiKey: options.apiKey ?? "export-only-no-network", prior,
        persist: (ledger) => paidStore.save(ledger), signal: options.signal, fetchImplementation: options.fetchImplementation });
      if (!prior) await paidStore.save(transport.snapshot());
      const results: { trajectoryId: string; state: string; status: string; primaryPath: string; backupPath: string; error?: string }[] = [];
      const states: EvaluationCheckpoint[] = [];
      const original = process.env.CONVERSATION_ALLOW_FAKE;
      process.env.CONVERSATION_ALLOW_FAKE = "1";
      try {
        for (const { manifest, route } of batch.trajectories) {
          const store = createCheckpointStore(primaryRoot, batch.runId, manifest.trajectoryId);
          if (options.recoverLocks) await store.recoverAbandonedLock();
          await store.exclusive(async () => {
            const priorState = await store.load();
            if (options.exportOnly && !priorState) { results.push({ trajectoryId: manifest.trajectoryId, state: "not_started", status: "not_archived", primaryPath: "", backupPath: "" }); return; }
            let step = 0;
            const pendingRequests = new Set<Promise<Response>>();
            const participants = createDeepSeekParticipants({ apiKey: options.apiKey ?? "export-only-no-network", userMode: "scripted", execute: (request) => {
              if (options.exportOnly) throw new Error("EXPORT_CANNOT_CALL_PROVIDER");
              const pending = transport.execute({ ...request, scope: { trajectoryId: manifest.trajectoryId, step } });
              pendingRequests.add(pending); void pending.then(() => pendingRequests.delete(pending), () => pendingRequests.delete(pending)); return pending;
            } });
            let state: EvaluationCheckpoint;
            if (options.exportOnly) {
              state = restoreCheckpoint(priorState, manifest);
              if (["running", "paused"].includes(state.status)) { state.status = "interrupted"; state.errorCode = "EXPORT_OF_INCOMPLETE_RUN"; await store.save(state); }
            } else {
              try { state = await runTrajectory({ manifest, route, checkpoint: priorState, participants, signal: options.signal,
                persist: async (checkpoint) => { step = checkpoint.activeStep ?? checkpoint.cursor; await store.save(checkpoint); } }); }
              catch { const durable = await store.load(); if (!durable) throw new Error("NO_DURABLE_CHECKPOINT"); state = restoreCheckpoint(durable, manifest); state.status = "interrupted"; state.errorCode = "PERSISTENCE_OR_EXECUTION_INTERRUPTED"; await store.save(state); }
              await Promise.allSettled([...pendingRequests]);
            }
            states.push(state);
            const archived = await archiveEvaluation({ primaryRoot, backupRoot: batch.backupRoot, input: renderReports(state, route, billing(transport.snapshot(), manifest.trajectoryId)) });
            results.push({ trajectoryId: manifest.trajectoryId, state: state.status, ...archived });
          });
        }
      } finally { if (original === undefined) delete process.env.CONVERSATION_ALLOW_FAKE; else process.env.CONVERSATION_ALLOW_FAKE = original; }
      const ledger = transport.snapshot();
      if (states.length === batch.trajectories.length) {
        const index = ["# Lucía DeepSeek Flash R01/R05 对照", "", "DeepSeek deepseek-flash + scripted user；高推理参数 reasoning_effort=high。该批次用于同输入模型对照，不代表真人体验、关系成长或整体可用。", "", `批次：${batch.runId}；代码/人物来源指纹：${batch.source.hash}`, "",
          ...states.map((state) => `- [${state.manifest.routeId} 聊天记录](../${state.manifest.trajectoryId}/聊天记录.md) · [问题总结](../${state.manifest.trajectoryId}/测试问题总结.md) · ${state.status} · 完成普通回合 ${state.turns.filter((turn) => turn.kind === "user" && turn.done).length}/${batch.trajectories.find((item) => item.manifest.trajectoryId === state.manifest.trajectoryId)!.route.steps.filter((step) => step.kind === "user").length}`), "", "## 计费/交付证据", "", `HTTP 调用：${ledger.entries.length}；保守预留单位：${ledger.reservedCostMicros}；usage 未转为费用，未知交付调用：${ledger.entries.filter((entry) => entry.status !== "not_sent").length}。`, "", "## 结构限制", "", "关系投影只记录完成回合的阶段与边界；两个 reviewer 仍是同模型调用，不能替代真人或独立供应商复核。"].join("\n");
        const archived = await archiveEvaluation({ primaryRoot, backupRoot: batch.backupRoot, input: { runId: batch.runId, trajectoryId: "batch-summary", transcriptMarkdown: index, summaryMarkdown: index,
          replay: { batch, ledger, results: states.map((state) => ({ trajectoryId: state.manifest.trajectoryId, status: state.status, checkpointHash: fingerprint(state) })) }, messageCount: states.reduce((sum, state) => sum + state.sandbox.messages.length, 0), turnCount: states.reduce((sum, state) => sum + state.turns.filter((turn) => turn.kind === "user").length, 0) } });
        results.push({ trajectoryId: "batch-summary", state: "index", ...archived });
      }
      return { runId: batch.runId, primaryRoot, backupRoot: batch.backupRoot, results, billing: { calls: ledger.calls, reservedCostMicros: ledger.reservedCostMicros, unknownCostCalls: ledger.entries.filter((entry) => entry.status !== "not_sent").length, blockedReason: ledger.blockedReason } };
    });
  });
}

