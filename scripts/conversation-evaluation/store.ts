import { mkdir, readdir, readFile, open, lstat, unlink, link } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { fingerprint, participantRoles, safeId, type EvaluationRoute } from "./manifest";
import type { EvaluationCheckpoint } from "./runner";
import type { ArchiveInput } from "./archive";
import { redactCheckpointText } from "./redaction";

async function assertNoLinks(target: string): Promise<void> {
  const parent = path.dirname(target);
  if (parent !== target) await assertNoLinks(parent);
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error("CHECKPOINT_LINK_PATH"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** Append-only complete snapshots. A corrupt newest snapshot must never fall back and replay calls. */
export function createCheckpointStore(root: string, runId: string, trajectoryId: string) {
  safeId.parse(runId); safeId.parse(trajectoryId);
  const directory = path.resolve(root, ".checkpoints", runId, trajectoryId);
  const lockPath = path.join(directory, "writer.lock");
  let ownsLock = false;
  const ready = async () => { await assertNoLinks(directory); await mkdir(directory, { recursive: true }); };
  const entries = async () => { await ready(); return (await readdir(directory)).filter((name) => /^checkpoint-\d{8}\.json$/u.test(name)).sort(); };
  return {
    directory,
    /** Explicit local recovery; PID reuse, unknown hosts and ambiguous locks fail closed. */
    async recoverAbandonedLock(): Promise<boolean> {
      await ready();
      let raw: string;
      try { await assertNoLinks(lockPath); raw = await readFile(lockPath, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
      const recoveryPath = path.join(directory, "recovery.lock");
      let guard;
      try { guard = await open(recoveryPath, "wx"); }
      catch { throw new Error("LOCK_RECOVERY_REQUIRES_INSPECTION"); }
      try {
        await guard.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname() }));
        let owner: { pid?: number; hostname?: string };
        try { owner = JSON.parse(raw) as typeof owner; } catch { throw new Error("LOCK_OWNER_UNKNOWN"); }
        if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || owner.hostname !== hostname()) throw new Error("LOCK_OWNER_UNKNOWN");
        try { process.kill(owner.pid!, 0); throw new Error("TRAJECTORY_LOCKED"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        // Competing recoveries hold this guard; normal writers cannot acquire the existing lock.
        if (await readFile(lockPath, "utf8") !== raw) throw new Error("LOCK_OWNER_CHANGED");
        await unlink(lockPath);
        return true;
      } finally { await guard.close(); await unlink(recoveryPath); }
    },
    async load(): Promise<unknown | undefined> {
      const latest = (await entries()).at(-1);
      if (!latest) return undefined;
      try {
        const target = path.join(directory, latest); await assertNoLinks(target);
        const envelope = JSON.parse(await readFile(target, "utf8")) as { hash?: string; state?: unknown };
        if (!envelope.hash || fingerprint(envelope.state) !== envelope.hash) throw new Error();
        return envelope.state;
      } catch { throw new Error("CHECKPOINT_CORRUPT"); }
    },
    async save(state: unknown): Promise<void> {
      if (!ownsLock) throw new Error("CHECKPOINT_REQUIRES_LOCK");
      const previous = (await entries()).at(-1);
      const serial = previous ? Number(previous.slice(11, 19)) + 1 : 1;
      if (serial > 99999999) throw new Error("CHECKPOINT_LIMIT");
      const target = path.join(directory, `checkpoint-${String(serial).padStart(8, "0")}.json`);
      const temp = path.join(directory, `.pending-${randomUUID()}`);
      const serialized = JSON.stringify(state);
      const normalized: unknown = JSON.parse(serialized);
      const file = await open(temp, "wx");
      try { await file.writeFile(JSON.stringify({ hash: fingerprint(normalized), state: normalized }, null, 2) + "\n", "utf8"); await file.sync(); }
      finally { await file.close(); }
      try { await link(temp, target); }
      finally { await unlink(temp).catch(() => {}); }
    },
    async exclusive<T>(work: () => Promise<T>): Promise<T> {
      await ready();
      if (ownsLock) throw new Error("TRAJECTORY_LOCKED");
      let lock;
      try { lock = await open(lockPath, "wx"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("TRAJECTORY_LOCKED"); throw error; }
      ownsLock = true;
      try { await lock.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() })); return await work(); }
      finally { ownsLock = false; await lock.close(); await unlink(lockPath); }
    },
  };
}

const quote = (text: string) => text.split(/\r?\n/u).map((line) => `> ${line}`).join("\n");
const canonicalReportJson = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry, 2);
export function renderReports(originalState: EvaluationCheckpoint, route: EvaluationRoute, billing?: unknown): ArchiveInput {
  const state = redactCheckpointText(originalState);
  const real = state.manifest.mode === "real";
  const fixedUser = state.manifest.participants.user === "scripted-user-v2";
  const messages = state.sandbox.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status, at: new Date(m.createdAt).toISOString(), sourceType: m.sourceType }));
  if (state.partial && !messages.some((m) => m.id === state.partial?.id)) messages.push({ id: state.partial.id, role: "character", content: state.partial.content,
    status: "streaming", at: state.partial.at, sourceType: "uncertain-delivery-prefix" });
  const ordinaryTurns = state.turns.filter((t) => t.kind === "user");
  const transcript = [real ? "# Lucía 真实模型与合成用户聊天记录" : "# Lucía 离线合成聊天记录", "", real ? fixedUser ? "MiniMax 真实生成角色回复；用户为固定路线输入，不调用模拟用户模型，不是自适应真人模拟或线上验收。" : "MiniMax 真实生成，用户为 AI 模拟；隔离本地状态，不是真实用户聊天或线上数据库验收。" : "此文件是 fake 执行器测试，不是真实模型质量测试。", "",
    `运行：${state.manifest.runId} / ${state.manifest.trajectoryId}`, `路线：${route.routeId} ${route.label}`, `终态：${state.status}`, "",
    `安全重试上限：每个角色回复 ${state.manifest.safetyRetryLimit ?? 1} 次（仅评估门禁重写，所有尝试均计入调用与成本）`, "",
    ...messages.flatMap((m, i) => [`## 消息 ${i + 1} · ${m.role === "user" ? "合成用户" : "Lucía"}`, "",
      `ID：${m.id}｜模拟时间：${m.at}｜状态：${m.status}｜来源：${m.sourceType ?? "conversation"}`, "", quote(m.content), ""]),
    "## 会话与完整回合索引", "",
    ...state.turns.map((t) => `- step ${t.step} / session ${t.session} / ${t.at} / ${t.kind} / generation ${t.generationId}：${t.done ? "完成" : "未完成"}（${t.result}）`),
  ].join("\n") + "\n";
  const problems = state.turns.filter((t) => !t.done).map((t) => `- [执行问题] step ${t.step} / session ${t.session}：${t.result}；done=false，禁止派生关系证据。`);
  const rejected = state.traces.filter((t) => t.gate === "safety-gate");
  const summary = ["# 测试问题总结", "", real ? `**真实模型现状基线；完成执行不等于质量通过。** ${fixedUser ? "用户采用固定路线刺激，不是自适应模拟；" : "用户由模型模拟；"}计划两次分开上下文的同模型评审，实际完成 ${state.reviews.length}/2 次，结论须结合逐字证据复核。` : "**本轮不代表真实聊天质量通过。** 模拟用户、角色与评审均为确定性 fake。", "",
    `路线：${route.routeId} ${route.label}`, `预期：${route.expectedOutcome}`, `执行终态：${state.status}`, `错误：${state.errorCode ?? "无"}`, "",
    `安全重试上限：每个角色回复 ${state.manifest.safetyRetryLimit ?? 1} 次（仅评估门禁重写，所有尝试均计入调用与成本）`, "",
    "## 结果与限制", "", real ? `${state.reviews.length ? "模型评审仅给出候选判断。" : "未完成自动语义评审，需单独复核可见文本与失败证据。"}关系投影已按完成回合记录阶段与边界，但这不等于真实模型或真人体验通过。` : "人格、自然西语与长期关系语义：fake 不评估；本轮仅验证完成回合才会更新隔离关系投影。", "",
    ...state.limitations.map((l) => `- ${l}`), "",
    ...(state.parent ? [`分叉来源：${state.parent.runId}/${state.parent.trajectoryId}，检查点 ${state.parent.checkpointHash}，继承到 step ${state.parent.cursor}；不是独立初识样本。`, ""] : []),
    "## 执行问题与证据", "", ...(problems.length ? problems : ["本次执行未记录失败回合；这不代表不存在语义问题。"]),
    ...rejected.map((t) => `- [安全检查] step ${t.step}，调用 ${t.id} 被拦截：\n${quote(t.output ?? "无正文")}`), "",
    "## 状态变化", "", ...state.turns.map((t) => `- step ${t.step}：${t.stageBefore} → ${t.stageAfter}；记忆 ${t.memoryCountBefore} → ${t.memoryCountAfter}；${t.result}`), "",
    "## 调用与成本", "", `普通回合：${ordinaryTurns.length}；完成：${ordinaryTurns.filter((t) => t.done).length}；主动机会：${state.turns.length - ordinaryTurns.length}。`,
    ...participantRoles.map((role) => { const value = state.ledger[role]; return `- ${role}：${value.calls} 次调用预留，${state.traces.filter((t) => t.role === role && t.invoked).length} 次已执行 ${real ? "参与者" : "fake"} 调用；${value.reservedTokens} 个规划 token 预留，不是实测 token。`; }),
    real ? `实际 HTTP 次数、usage、测算费用与未确认预留见下列计费证据；未知费用不是零。本轮累计执行时间：${Math.round(state.elapsedMs)} ms。` : `实际供应商费用：0（无网络调用）。本轮累计执行时间：${Math.round(state.elapsedMs)} ms。`, "",
    ...(real ? ["```json", canonicalReportJson(billing ?? { status: "not_available" }), "```", ""] : []),
    real ? "## 分开上下文的模型评审（待人工复核）" : "## 独立评审占位", "", ...state.reviews.flatMap((r) => [
      `- ${r.reviewer}：${r.verdict}；${r.notes}`,
      ...(r.findings ?? []).map((f) => `\n### ${f.severity} · ${f.category} · step ${f.step}\n\n${quote(f.quote)}\n\n${f.issue}`),
    ]), "",
    "## 复现与下一步", "", real ? "使用本目录 manifest、代码指纹、路线与计费证据检查；保留首答、拦截和失败，不重跑挑选好结果。仅输出问题与修复建议，本次不改人物或关系规则。" : "使用本目录回放数据中的 manifest、代码指纹和路线定义重新检查。先解决执行器问题；真实模型/语言评审与关系推进分别属于后续任务。不得靠重跑选择好样本。", "",
  ].join("\n");
  return { runId: state.manifest.runId, trajectoryId: state.manifest.trajectoryId, transcriptMarkdown: transcript,
    summaryMarkdown: summary, replay: JSON.parse(canonicalReportJson({ kind: real ? "real-model-synthetic-user" : "synthetic-offline", route, checkpoint: state, ...(real ? { billing } : {}) })) as unknown,
    messageCount: messages.length, turnCount: ordinaryTurns.length };
}
