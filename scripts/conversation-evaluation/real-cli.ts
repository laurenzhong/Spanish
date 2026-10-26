import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { archiveEvaluation } from "./archive";
import { desktopRoot, evaluationSourceFingerprint } from "./cli";
import { estimateBaselineBudget, fingerprint, realManifestSchema, routeSchema, safeId, type EvaluationRoute } from "./manifest";
import { coreRoutes, makeOfflineManifest, romanceConfirmationRoute } from "./routes";
import { regressionRoutes } from "./regression-routes";
import { estimateMiniMaxCostMicros } from "../../src/modules/providers/pricing/minimax-pricing";
import { createPaidTransport, type PaidLedger } from "./paid-transport";
import { createRealParticipants } from "./real-provider";
import { restoreCheckpoint, runTrajectory, type EvaluationCheckpoint } from "./runner";
import { createCheckpointStore, renderReports } from "./store";

export function parseRealArgs(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const flag = /^--(execute|export-only|recover-locks|regression|romance-confirmation|r04-only)$/u.exec(arg);
    const value = /^--(run-id|resume|primary-root|backup-root)=(.+)$/u.exec(arg);
    const key = flag?.[1] ?? value?.[1];
    if (!key || values.has(key)) throw new Error("INVALID_OR_DUPLICATE_OPTION");
    values.set(key, value?.[2] ?? "true");
  }
  if (values.has("execute") === values.has("export-only")) throw new Error("EXECUTE_OR_EXPORT_REQUIRED");
  if (values.has("run-id") && values.has("resume")) throw new Error("CONFLICTING_RUN_ID");
  if ((values.has("export-only") || values.has("recover-locks")) && !values.has("resume")) throw new Error("RESUME_REQUIRED");
  const runId = safeId.parse(values.get("resume") ?? values.get("run-id") ?? `baseline-${new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
  if (!runId.startsWith("baseline-")) throw new Error("BASELINE_ID_REQUIRED");
  if (["regression", "romance-confirmation", "r04-only"].filter((key) => values.has(key)).length > 1) throw new Error("CONFLICTING_ROUTE_SET");
  return { runId, resume: values.has("resume"), exportOnly: values.has("export-only"), recoverLocks: values.has("recover-locks"), regression: values.has("regression"), romanceConfirmation: values.has("romance-confirmation"), r04Only: values.has("r04-only"),
    primaryRoot: values.get("primary-root"), backupRoot: values.get("backup-root") };
}

export function makeRealManifest(runId: string, route: EvaluationRoute, codeFingerprint: string, safetyRetryLimit = 1) {
  const base = makeOfflineManifest({ runId, trajectoryId: route.routeId.toLowerCase(), route, codeFingerprint });
  if (!Number.isInteger(safetyRetryLimit) || safetyRetryLimit < 0 || safetyRetryLimit > 3) throw new Error("INVALID_SAFETY_RETRY_LIMIT");
  const characterMaxCalls = route.steps.reduce((sum, step) => sum + (step.kind === "user" ? 1 + safetyRetryLimit : 2), 0);
  return realManifestSchema.parse({ ...base, schemaVersion: 2, mode: "real", maxCostMicros: 7562784, maxWallMs: 1800000,
    safetyRetryLimit,
    budgetScope: route.routeId === "R06" ? "single-romance-confirmation-route" : "entire-three-trajectory-batch", authorization: "owner-continue-after-2026-10-25-budget-proposal",
    participants: { user: "scripted-user-v2", character: "MiniMax-M3.1-Flash/product", reviewer: "MiniMax-M3.1-Flash/reviewer-v1" },
    budget: { ...base.budget, user: { ...base.budget.user, maxReservedTokens: 0 }, character: { ...base.budget.character, maxCalls: characterMaxCalls, inputTokensPerCall: 32768, maxReservedTokens: characterMaxCalls * (32768 + 4896) } },
  });
}

export function trajectoryBilling(ledger: PaidLedger, trajectoryId: string) {
  const entries = ledger.entries.filter((entry) => entry.scope?.trajectoryId === trajectoryId);
  return { currency: "CNY", policyHash: ledger.policyHash, entireBatchCeilingMicros: 7562784,
    reservedCostMicros: entries.reduce((s, e) => s + e.reservedCostMicros, 0),
    measuredKnownCostMicros: entries.reduce((s, e) => s + (e.measuredCostMicros ?? 0), 0),
    unknownCostCalls: entries.filter((e) => e.measuredCostMicros === null && e.status !== "not_sent").length,
    note: "Known usage is not the full bill when unknownCostCalls>0. Reservations are retained for failures and are not measured costs. Byte input bounds are conservative planning estimates, not provider tokenization proof.", entries };
}

const batchSchema = z.object({ version: z.literal(1), mode: z.literal("real"), runId: safeId,
  scope: z.enum(["fixed-core-v2", "fixed-regression-v1", "fixed-romance-confirmation-v1", "fixed-r04-only-v1"]).optional(),
  createdAt: z.iso.datetime(), primaryRoot: z.string(), backupRoot: z.string(), source: z.object({ hash: z.string(), sources: z.array(z.object({ file: z.string(), hash: z.string() })) }),
  estimate: z.unknown(), trajectories: z.array(z.object({ manifest: realManifestSchema, route: routeSchema })).min(1).max(3),
}).strict();

export async function runRealBaseline(options: ReturnType<typeof parseRealArgs> & {
  repoRoot: string; apiKey?: string; signal?: AbortSignal; fetchImplementation?: typeof fetch;
  onProgress?: (progress: { trajectoryId: string; step: number; status: string; calls: number }) => void;
}) {
  if (process.env.NODE_ENV === "production") throw new Error("EVALUATION_REFUSES_PRODUCTION");
  if (!options.exportOnly && !options.apiKey?.trim()) throw new Error("API_KEY_REQUIRED");
  const primaryRoot = path.resolve(options.primaryRoot ?? path.join(options.repoRoot, "artifacts/conversation-evaluations"));
  const batchStore = createCheckpointStore(primaryRoot, options.runId, "batch-real");
  if (options.recoverLocks) await batchStore.recoverAbandonedLock();
  return batchStore.exclusive(async () => {
    const previous = await batchStore.load();
    if (options.resume && !previous) throw new Error("RUN_NOT_FOUND");
    if (!options.resume && previous) throw new Error("RUN_EXISTS_USE_RESUME_OR_NEW_ID");
    const batch = previous ? batchSchema.parse(previous) : await (async () => {
      const source = await evaluationSourceFingerprint(options.repoRoot);
      const routes = options.romanceConfirmation ? [romanceConfirmationRoute] : options.r04Only ? [coreRoutes.find((route) => route.routeId === "R04")] : options.regression ? regressionRoutes : coreRoutes;
      if (routes.some((route): route is undefined => !route)) throw new Error("ROUTE_SET_UNAVAILABLE");
      const selectedRoutes = routes as EvaluationRoute[];
      const safetyRetryLimit = options.r04Only ? 2 : 1;
      const plannedCharacterCalls = selectedRoutes.reduce((sum, route) => sum + route.steps.reduce((routeCalls, step) => routeCalls + (step.kind === "user" ? 1 + safetyRetryLimit : 2), 0), 0);
      const model = "MiniMax-M3.1-Flash";
      const characterCost = estimateMiniMaxCostMicros({ modelVersion: model, inputTokens: 32768, outputTokens: 4896 })!;
      const reviewCost = estimateMiniMaxCostMicros({ modelVersion: model, inputTokens: 64000, outputTokens: 5596 })!;
      return batchSchema.parse({ version: 1, mode: "real", scope: options.romanceConfirmation ? "fixed-romance-confirmation-v1" : options.r04Only ? "fixed-r04-only-v1" : options.regression ? "fixed-regression-v1" : "fixed-core-v2", runId: options.runId, createdAt: new Date().toISOString(), primaryRoot,
        backupRoot: path.resolve(options.backupRoot ?? desktopRoot()), source, estimate: { ...estimateBaselineBudget(),
          roles: { user: { calls: 0 }, character: { calls: plannedCharacterCalls }, reviewer: { calls: 6 } }, totalCalls: plannedCharacterCalls + 6,
        totalCny: Math.min(7562784, plannedCharacterCalls * characterCost + 6 * reviewCost) / 1000000, authorizedRealCostMicros: 7562784,
          safetyRetryLimit, assumptions: `Fixed user stimuli, no user model calls. At most ${1 + safetyRetryLimit} character calls per user step and two calls per proactive opportunity; all attempts are budgeted and archived.` },
        trajectories: selectedRoutes.map((route) => ({ route, manifest: makeRealManifest(options.runId, route, source.hash, safetyRetryLimit) })) });
    })();
    if (batch.runId !== options.runId || path.resolve(batch.primaryRoot) !== primaryRoot) throw new Error("BATCH_SCOPE_MISMATCH");
    if (options.regression && batch.scope !== "fixed-regression-v1") throw new Error("BATCH_SCOPE_MISMATCH");
    if (options.romanceConfirmation && batch.scope !== "fixed-romance-confirmation-v1") throw new Error("BATCH_SCOPE_MISMATCH");
    if (options.r04Only && batch.scope !== "fixed-r04-only-v1") throw new Error("BATCH_SCOPE_MISMATCH");
    if (options.backupRoot && path.resolve(options.backupRoot) !== path.resolve(batch.backupRoot)) throw new Error("BACKUP_ROOT_MISMATCH");
    const within = (a: string, b: string) => { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r)); };
    if (within(primaryRoot, batch.backupRoot) || within(batch.backupRoot, primaryRoot)) throw new Error("ARCHIVE_ROOTS_MUST_BE_SEPARATE");
    if (previous && !options.exportOnly && (await evaluationSourceFingerprint(options.repoRoot)).hash !== batch.source.hash) throw new Error("SOURCE_CHANGED_USE_EXPORT_ONLY");
    if (!previous) await batchStore.save(batch);
    const paidStore = createCheckpointStore(primaryRoot, batch.runId, "paid-ledger");
    if (options.recoverLocks) await paidStore.recoverAbandonedLock();
    return paidStore.exclusive(async () => {
      const prior = await paidStore.load();
      if (options.exportOnly && !prior) throw new Error("PAID_LEDGER_NOT_FOUND");
      const transport = createPaidTransport({ apiKey: options.exportOnly ? "export-only-no-network" : options.apiKey!, prior,
        persist: (ledger) => paidStore.save(ledger), signal: options.signal, fetchImplementation: options.fetchImplementation });
      if (!prior) await paidStore.save(transport.snapshot());
      const results: { trajectoryId: string; state: string; status: string; primaryPath: string; backupPath: string; error?: string }[] = [];
      const states: EvaluationCheckpoint[] = [];
      const original = process.env.CONVERSATION_ALLOW_FAKE;
      // Static authored catalog fallback only; real participants are explicitly supplied below.
      process.env.CONVERSATION_ALLOW_FAKE = "1";
      try {
        for (const { manifest, route } of batch.trajectories) {
          const store = createCheckpointStore(primaryRoot, batch.runId, manifest.trajectoryId);
          if (options.recoverLocks) await store.recoverAbandonedLock();
          await store.exclusive(async () => {
            const priorState = await store.load();
            if (options.exportOnly && !priorState) {
              results.push({ trajectoryId: manifest.trajectoryId, state: "not_started", status: "not_archived", primaryPath: "", backupPath: "" }); return;
            }
            let step = 0, lastProgress = -1;
            const pendingRequests = new Set<Promise<Response>>();
            const participants = createRealParticipants({ apiKey: options.apiKey ?? "export-only-no-network", userMode: manifest.participants.user === "scripted-user-v2" ? "scripted" : "model", execute: (request) => {
              if (options.exportOnly) throw new Error("EXPORT_CANNOT_CALL_PROVIDER");
              const pending = transport.execute({ ...request, scope: { trajectoryId: manifest.trajectoryId, step } });
              pendingRequests.add(pending);
              void pending.then(() => pendingRequests.delete(pending), () => pendingRequests.delete(pending));
              return pending;
            } });
            let state: EvaluationCheckpoint;
            if (options.exportOnly) {
              state = restoreCheckpoint(priorState, manifest);
              if (["running", "paused"].includes(state.status)) { state.status = "interrupted"; state.errorCode = "EXPORT_OF_INCOMPLETE_RUN"; await store.save(state); }
            } else {
              try {
                state = await runTrajectory({ manifest, route, checkpoint: priorState, participants, signal: options.signal,
                  persist: async (s) => {
                    step = s.activeStep ?? s.cursor; await store.save(s);
                    if (s.cursor !== lastProgress) { lastProgress = s.cursor; options.onProgress?.({ trajectoryId: manifest.trajectoryId, step: s.cursor, status: s.status, calls: transport.snapshot().entries.length }); }
                  } });
              } catch {
                const durable = await store.load();
                if (!durable) throw new Error("NO_DURABLE_CHECKPOINT");
                state = restoreCheckpoint(durable, manifest); state.status = "interrupted"; state.errorCode = "PERSISTENCE_OR_EXECUTION_INTERRUPTED"; await store.save(state);
              }
              // Runner cancellation may win its race while HTTP/ledger persistence is still settling.
              // Freeze billing only after every reserved request has reached its durable terminal state.
              await Promise.allSettled([...pendingRequests]);
              if (!priorState && state.status !== "completed" && transport.snapshot().blockedReason) {
                state.errorCode = transport.snapshot().blockedReason; await store.save(state);
              }
            }
            states.push(state);
            const archived = await archiveEvaluation({ primaryRoot, backupRoot: batch.backupRoot, input: renderReports(state, route, trajectoryBilling(transport.snapshot(), manifest.trajectoryId)) });
            results.push({ trajectoryId: manifest.trajectoryId, state: state.status, ...archived });
          });
        }
      } finally { if (original === undefined) delete process.env.CONVERSATION_ALLOW_FAKE; else process.env.CONVERSATION_ALLOW_FAKE = original; }
      const ledger = transport.snapshot();
      if (states.length === batch.trajectories.length) {
        const index = ["# Lucía 真实模型现状基线", "", batch.scope ? `真实 MiniMax 角色回复 + 固定测试输入（${batch.scope}）；不是自适应真人模拟。不能视为线上人物或关系成长通过。` : "真实 MiniMax 模型 + 合成用户；未修改人物或关系规则。不能视为线上人物、真人体验或关系成长通过。", "",
          `批次：${batch.runId}；本地代码/人物来源指纹：${batch.source.hash}`, "",
          ...states.map((s) => `- [${s.manifest.routeId} 聊天记录](../${s.manifest.trajectoryId}/聊天记录.md) · [问题总结](../${s.manifest.trajectoryId}/测试问题总结.md) · ${s.status} · 完成普通来回 ${s.turns.filter((t) => t.kind === "user" && t.done).length}/${batch.trajectories.find((t) => t.manifest.trajectoryId === s.manifest.trajectoryId)!.route.steps.filter((step) => step.kind === "user").length}`), "",
          "## 计费证据", "", `实际 HTTP 预留次数：${ledger.entries.length}；预留费用：¥${ledger.reservedCostMicros / 1000000}；已知 usage 测算：¥${ledger.entries.reduce((s, e) => s + (e.measuredCostMicros ?? 0), 0) / 1000000}；计费未知调用：${ledger.entries.filter((e) => e.measuredCostMicros === null && e.status !== "not_sent").length}。`,
          `预留上限 ¥7.562784；终止原因：${ledger.blockedReason ?? "无传输层阻断"}。预留不是账单，字节输入界限为保守估算；未知调用不作零费用。`, "",
          "## 结构限制", "", "关系投影会记录完成回合的阶段与边界，但真实模型路线仍需按回放证据复核；两个评审为同模型分开上下文调用，仍需要独立证据复核。", "",
        ].join("\n");
        const archived = await archiveEvaluation({ primaryRoot, backupRoot: batch.backupRoot, input: { runId: batch.runId, trajectoryId: "batch-summary",
          transcriptMarkdown: index, summaryMarkdown: index, replay: { batch, ledger, results: states.map((s) => ({ trajectoryId: s.manifest.trajectoryId, status: s.status, checkpointHash: fingerprint(s) })) },
          messageCount: states.reduce((sum, s) => sum + s.sandbox.messages.length, 0), turnCount: states.reduce((sum, s) => sum + s.turns.filter((t) => t.kind === "user").length, 0) } });
        results.push({ trajectoryId: "batch-summary", state: "index", ...archived });
      }
      return { runId: batch.runId, primaryRoot, backupRoot: batch.backupRoot, results, billing: { calls: ledger.calls, reservedCostMicros: ledger.reservedCostMicros,
        knownMeasuredCostMicros: ledger.entries.reduce((sum, e) => sum + (e.measuredCostMicros ?? 0), 0), blockedReason: ledger.blockedReason } };
    });
  });
}
