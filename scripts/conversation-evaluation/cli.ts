import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { archiveEvaluation } from "./archive";
import { estimateBaselineBudget, fingerprint, fakeManifestSchema, routeSchema, safeId } from "./manifest";
import { coreRoutes, makeOfflineManifest } from "./routes";
import { restoreCheckpoint, runTrajectory, type EvaluationCheckpoint } from "./runner";
import { createCheckpointStore, renderReports } from "./store";

export function parseEvaluationArgs(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    if (["--export-only", "--recover-locks"].includes(arg)) { const key = arg.slice(2); if (values.has(key)) throw new Error("DUPLICATE_OPTION"); values.set(key, "true"); continue; }
    const match = /^--(run-id|resume|primary-root|backup-root)=(.+)$/u.exec(arg);
    if (!match || values.has(match[1])) throw new Error("INVALID_OPTION_FAKE_ONLY");
    values.set(match[1], match[2]);
  }
  if (values.has("run-id") && values.has("resume")) throw new Error("CONFLICTING_RUN_ID");
  if (values.has("export-only") && !values.has("resume")) throw new Error("EXPORT_REQUIRES_RESUME");
  if (values.has("recover-locks") && !values.has("resume")) throw new Error("RECOVERY_REQUIRES_RESUME");
  const runId = safeId.parse(values.get("resume") ?? values.get("run-id") ?? `offline-${new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
  return { runId, resume: values.has("resume"), exportOnly: values.has("export-only"), recoverLocks: values.has("recover-locks"),
    primaryRoot: values.get("primary-root"), backupRoot: values.get("backup-root") };
}

export function desktopRoot(): string {
  if (process.platform !== "win32") throw new Error("BACKUP_ROOT_REQUIRED_ON_THIS_PLATFORM");
  const desktop = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"], { encoding: "utf8", windowsHide: true }).trim();
  if (!desktop || !path.isAbsolute(desktop)) throw new Error("DESKTOP_UNAVAILABLE");
  return path.join(desktop, "Lucia聊天测试");
}

/** Explicit source allowlist: never scan .env, runtime data or credentials. */
export async function evaluationSourceFingerprint(repoRoot: string) {
  const roots = ["scripts/conversation-evaluation", "src/modules/conversation/application", "src/modules/conversation/domain",
    "src/modules/conversation/schemas", "src/modules/characters", "src/modules/memory", "src/modules/character-network/domain",
    "src/modules/providers/conversation", "src/modules/providers/pricing", "src/modules/providers/minimax", "content/characters"];
  const files = ["scripts/run-conversation-evaluation.ts", "scripts/run-conversation-baseline.ts", "scripts/conversation-evaluation/calibration.md", "package.json", "pnpm-lock.yaml", "tsconfig.json"];
  async function collect(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(repoRoot, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("SOURCE_LINK_REFUSED");
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await collect(child);
      else if (/\.(?:ts|tsx|json)$/u.test(entry.name)) files.push(child);
    }
  }
  for (const root of roots) await collect(root);
  const sources = await Promise.all(files.sort().map(async (file) => ({ file, hash: fingerprint(await readFile(path.join(repoRoot, file), "utf8")) })));
  return { hash: fingerprint(sources), sources };
}

const batchSchema = z.object({
  schemaVersion: z.literal(1), runId: safeId, createdAt: z.iso.datetime(), mode: z.literal("fake"),
  primaryRoot: z.string(), backupRoot: z.string(), source: z.object({ hash: z.string(), sources: z.array(z.object({ file: z.string(), hash: z.string() })) }),
  budgetEstimate: z.unknown(), trajectories: z.array(z.object({ manifest: fakeManifestSchema, route: routeSchema })).length(3),
}).strict();

export async function runEvaluationBatch(options: ReturnType<typeof parseEvaluationArgs> & { repoRoot: string; signal?: AbortSignal }) {
  if (process.env.NODE_ENV === "production") throw new Error("OFFLINE_EVALUATION_REFUSES_PRODUCTION");
  const primaryRoot = path.resolve(options.primaryRoot ?? path.join(options.repoRoot, "artifacts/conversation-evaluations"));
  const batchStore = createCheckpointStore(primaryRoot, options.runId, "batch");
  if (options.recoverLocks) await batchStore.recoverAbandonedLock();
  return batchStore.exclusive(async () => {
    const previous = await batchStore.load();
    if (options.resume && !previous) throw new Error("RUN_NOT_FOUND");
    if (!options.resume && previous) throw new Error("RUN_EXISTS_USE_RESUME_OR_NEW_ID");
    let batch;
    if (previous) {
      batch = batchSchema.parse(previous);
      if (batch.runId !== options.runId || path.resolve(batch.primaryRoot) !== primaryRoot) throw new Error("BATCH_SCOPE_MISMATCH");
      if (options.backupRoot && path.resolve(options.backupRoot) !== path.resolve(batch.backupRoot)) throw new Error("BACKUP_ROOT_MISMATCH");
      if (!options.exportOnly && (await evaluationSourceFingerprint(options.repoRoot)).hash !== batch.source.hash) throw new Error("SOURCE_CHANGED_USE_EXPORT_ONLY");
    } else {
      const source = await evaluationSourceFingerprint(options.repoRoot);
      batch = batchSchema.parse({ schemaVersion: 1, runId: options.runId, createdAt: new Date().toISOString(), mode: "fake", primaryRoot,
        backupRoot: path.resolve(options.backupRoot ?? desktopRoot()), source, budgetEstimate: estimateBaselineBudget(),
        trajectories: coreRoutes.map((route) => ({ route, manifest: makeOfflineManifest({ runId: options.runId, trajectoryId: route.routeId.toLowerCase(), route, codeFingerprint: source.hash }) })) });
      const relative = path.relative(primaryRoot, batch.backupRoot);
      const reverse = path.relative(batch.backupRoot, primaryRoot);
      const within = (r: string) => r === "" || (!r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r));
      if (within(relative) || within(reverse)) throw new Error("ARCHIVE_ROOTS_MUST_BE_SEPARATE");
      await batchStore.save(batch);
    }
    const results: { trajectoryId: string; state: string; status: string; primaryPath: string; backupPath: string; error?: string }[] = [];
    const checkpoints: EvaluationCheckpoint[] = [];
    const priorFakeOptIn = process.env.CONVERSATION_ALLOW_FAKE;
    process.env.CONVERSATION_ALLOW_FAKE = "1";
    try {
      for (const { manifest, route } of batch.trajectories) {
        const store = createCheckpointStore(primaryRoot, batch.runId, manifest.trajectoryId);
        if (options.recoverLocks) await store.recoverAbandonedLock();
        await store.exclusive(async () => {
          const checkpoint = await store.load();
          if (options.exportOnly && !checkpoint) {
            results.push({ trajectoryId: manifest.trajectoryId, state: "not_started", status: "not_archived", primaryPath: "", backupPath: "", error: "NO_CHECKPOINT" }); return;
          }
          let state: EvaluationCheckpoint;
          if (options.exportOnly) {
            state = restoreCheckpoint(checkpoint, manifest);
            if (["running", "paused"].includes(state.status)) {
              state.status = "interrupted"; state.errorCode = "EXPORT_OF_INCOMPLETE_RUN"; await store.save(state);
            }
          } else {
            try { state = await runTrajectory({ manifest, route, checkpoint, signal: options.signal, persist: (s) => store.save(s) }); }
            catch {
              const last = await store.load();
              if (!last) throw new Error("NO_DURABLE_CHECKPOINT");
              state = restoreCheckpoint(last, manifest);
              state.status = "interrupted"; state.errorCode = "PERSISTENCE_OR_EXECUTION_INTERRUPTED";
              await store.save(state);
            }
          }
          checkpoints.push(state);
          const archived = await archiveEvaluation({ primaryRoot, backupRoot: batch.backupRoot, input: renderReports(state, route) });
          results.push({ trajectoryId: manifest.trajectoryId, state: state.status, ...archived });
        });
      }
    } finally {
      if (priorFakeOptIn === undefined) delete process.env.CONVERSATION_ALLOW_FAKE;
      else process.env.CONVERSATION_ALLOW_FAKE = priorFakeOptIn;
    }
    if (checkpoints.length === batch.trajectories.length) {
      const index = ["# Lucía 离线执行器验证索引", "", "**FAKE：不代表真实模型、人设或感情发展已通过。**", "",
        `批次：${batch.runId}；创建时间：${batch.createdAt}（UTC）`, "",
        ...checkpoints.map((s) => `- [${s.manifest.routeId} 聊天记录](../${s.manifest.trajectoryId}/聊天记录.md) · [问题总结](../${s.manifest.trajectoryId}/测试问题总结.md) · ${s.status} · ${s.turns.filter((t) => t.kind === "user").length} 个普通来回`),
        "", "每条路线从独立初识开始；同路线跨会话保留状态。主档和桌面备份均长期保留。", "",
        "## 下一阶段预算估算", "", "以下仅为规划上限，实际收费授权为 0；模型、token 输入上限或重试策略变化后须重算。", "", "```json", JSON.stringify(batch.budgetEstimate, null, 2), "```", "",
        "校准依据：docs/superpowers/specs/2026-10-25-lucia-longitudinal-conversation-evaluation-design.md 第 2.1、5、7 节。", "",
        "当前只执行 calibration 三条路线；holdout 尚未执行。评审占位不提供质量分数。", "",
      ].join("\n");
      const archived = await archiveEvaluation({ primaryRoot, backupRoot: batch.backupRoot, input: { runId: batch.runId, trajectoryId: "batch-summary",
        transcriptMarkdown: index, summaryMarkdown: index, replay: { batch, results: checkpoints.map((s) => ({ trajectoryId: s.manifest.trajectoryId, status: s.status, checkpointHash: fingerprint(s) })) },
        messageCount: checkpoints.reduce((sum, s) => sum + s.sandbox.messages.length, 0), turnCount: checkpoints.reduce((sum, s) => sum + s.turns.filter((t) => t.kind === "user").length, 0) } });
      results.push({ trajectoryId: "batch-summary", state: "index", ...archived });
    }
    return { runId: batch.runId, mode: batch.mode, primaryRoot, backupRoot: batch.backupRoot, results };
  });
}
