// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveEvaluation, type ArchiveInput } from "../../scripts/conversation-evaluation/archive";
import { redactArchivedBaseline } from "../../scripts/conversation-evaluation/redact-archive";
import { coreRoutes, makeOfflineManifest } from "../../scripts/conversation-evaluation/routes";
import { fingerprint, manifestSchema } from "../../scripts/conversation-evaluation/manifest";
import { runTrajectory, restoreCheckpoint, type EvaluationCheckpoint } from "../../scripts/conversation-evaluation/runner";
import { createCheckpointStore, renderReports } from "../../scripts/conversation-evaluation/store";

const marker = "synthetic-test-only </mm:think>";
const runId = "redaction-fixture";
const roots: string[] = [];
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("conv-redact-")) throw new Error("UNSAFE_TEST_CLEANUP");
    await rm(root, { recursive: true, force: true });
  }
});
async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else result[path.relative(root, file)] = await readFile(file, "utf8");
    }
  }
  await walk(root); return result;
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "conv-redact-")); roots.push(root);
  const primaryRoot = path.join(root, "primary"), backupRoot = path.join(root, "backup");
  const states: EvaluationCheckpoint[] = [];
  for (const scope of ["batch-real", "paid-ledger", "r01", "r04", "r05"]) await mkdir(path.join(primaryRoot, ".checkpoints", runId, scope), { recursive: true });
  for (const scope of ["batch-real", "paid-ledger"]) await writeFile(path.join(primaryRoot, ".checkpoints", runId, scope, "checkpoint-00000001.json"), json({ hash: fingerprint({ untouched: scope }), state: { untouched: scope } }));
  for (const [index, trajectoryId] of ["r01", "r04", "r05"].entries()) {
    const route = { ...structuredClone(coreRoutes[index]), steps: structuredClone(coreRoutes[index].steps.slice(0, 1)) };
    const state = await runTrajectory({ route, manifest: makeOfflineManifest({ runId, trajectoryId, route }) });
    // A real-shaped archived fixture made entirely with offline fake execution.
    state.manifest = manifestSchema.parse({ ...state.manifest, schemaVersion: 2, mode: "real", maxCostMicros: 7562784,
      participants: { user: "MiniMax-M3.1-Flash/actor-v1", character: "MiniMax-M3.1-Flash/product", reviewer: "MiniMax-M3.1-Flash/reviewer-v1" },
      budgetScope: "entire-three-trajectory-batch", authorization: "owner-continue-after-2026-10-25-budget-proposal" });
    state.manifestHash = fingerprint(state.manifest);
    if (index === 0) {
      const trace = state.traces.find((trace) => trace.role === "character")!;
      trace.output = "safe-candidate-fixture"; trace.gate = "safety-gate";
    }
    const input = { ...renderReports(state, route, { knownMeasuredCostMicros: 123, source: "synthetic-fixture" }) };
    if (index === 0) {
      state.traces.find((trace) => trace.role === "character")!.output = marker;
      // Reconstruct the former unsanitized archive without ever using real provider reasoning.
      input.summaryMarkdown = input.summaryMarkdown.replace("safe-candidate-fixture", marker);
      input.replay = JSON.parse(JSON.stringify(input.replay).replace("safe-candidate-fixture", marker));
    }
    expect((await archiveEvaluation({ primaryRoot, backupRoot, input })).status).toBe("complete");
    const normalized = JSON.parse(JSON.stringify(state)) as EvaluationCheckpoint;
    states.push(normalized);
    for (const serial of [1, 2]) await writeFile(path.join(primaryRoot, ".checkpoints", runId, trajectoryId, `checkpoint-${String(serial).padStart(8, "0")}.json`), json({ hash: fingerprint(normalized), state: normalized }));
  }
  const batchInput: ArchiveInput = { runId, trajectoryId: "batch-summary", transcriptMarkdown: "# Original batch transcript\n", summaryMarkdown: "# Original batch summary\n",
    replay: { batch: { originalCodeFingerprint: "unchanged" }, ledger: { amount: 123 }, results: states.map((state) => ({ trajectoryId: state.manifest.trajectoryId, status: state.status, checkpointHash: fingerprint(state) })) },
    messageCount: states.reduce((sum, state) => sum + state.sandbox.messages.length, 0), turnCount: states.length };
  expect((await archiveEvaluation({ primaryRoot, backupRoot, input: batchInput })).status).toBe("complete");
  return { primaryRoot, backupRoot, runId, states, batchInput };
}

describe("explicit ended-batch privacy redaction", () => {
  it("sanitizes checkpoint envelopes and identical archives with hash-only audit; pure export and repeat stay stable", async () => {
    const f = await fixture();
    const originalMain = await files(f.primaryRoot), originalBackup = await files(f.backupRoot);
    const result = await redactArchivedBaseline(f);
    expect(result.status).toBe("redacted");
    const main = await files(f.primaryRoot), backup = await files(f.backupRoot);
    expect(Object.values(main).join("\n")).not.toContain(marker);
    expect(Object.values(backup).join("\n")).not.toContain(marker);
    const auditPath = path.join(runId, "redaction-audit.json");
    expect(backup[auditPath]).toBe(main[auditPath]);
    const audit = JSON.parse(main[auditPath]) as { events: { scope: string; files: { location: "primary" | "backup"; path: string; originalSha256: string; newSha256: string }[] }[] };
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].scope).toBe("nonvisible candidate redaction");
    for (const change of audit.events[0].files) {
      expect(change.originalSha256).toBe(hash((change.location === "primary" ? originalMain : originalBackup)[change.path]));
      expect(change.newSha256).toBe(hash((change.location === "primary" ? main : backup)[change.path]));
    }
    for (const scope of ["batch-real", "paid-ledger"]) {
      const name = path.join(".checkpoints", runId, scope, "checkpoint-00000001.json");
      expect(main[name]).toBe(originalMain[name]);
    }
    const states: EvaluationCheckpoint[] = [];
    for (const trajectoryId of ["r01", "r04", "r05"]) {
      const dir = path.join(runId, trajectoryId);
      expect(main[path.join(dir, "聊天记录.md")]).toBe(originalMain[path.join(dir, "聊天记录.md")]);
      const originalIntent = JSON.parse(originalMain[path.join(dir, ".archive-intent.json")]);
      expect(JSON.parse(main[path.join(dir, ".archive-intent.json")])).toMatchObject({ createdAt: originalIntent.createdAt, primaryPath: originalIntent.primaryPath, backupPath: originalIntent.backupPath });
      const replay = JSON.parse(main[path.join(dir, "回放数据.json")]);
      const store = createCheckpointStore(f.primaryRoot, runId, trajectoryId);
      const loaded = await store.load();
      const state = restoreCheckpoint(loaded, replay.checkpoint.manifest);
      states.push(state);
      expect(state.status).toBe("completed");
      expect(state.turns).toEqual(f.states.find((entry) => entry.manifest.trajectoryId === trajectoryId)!.turns);
      expect(state.manifest).toEqual(f.states.find((entry) => entry.manifest.trajectoryId === trajectoryId)!.manifest);
      expect(fingerprint(replay.checkpoint)).toBe(fingerprint(state));
      const regenerated = renderReports(state, replay.route, replay.billing);
      expect(regenerated.transcriptMarkdown).toBe(main[path.join(dir, "聊天记录.md")]);
      expect(regenerated.summaryMarkdown).toBe(main[path.join(dir, "测试问题总结.md")]);
      expect(json(regenerated.replay)).toBe(main[path.join(dir, "回放数据.json")]);
      expect(await archiveEvaluation({ ...f, input: regenerated })).toMatchObject({ status: "complete" });
    }
    const batchReplay = JSON.parse(main[path.join(runId, "batch-summary", "回放数据.json")]);
    expect(batchReplay.results.map((entry: { checkpointHash: string }) => entry.checkpointHash)).toEqual(states.map(fingerprint));
    expect(batchReplay.batch).toEqual({ originalCodeFingerprint: "unchanged" });
    expect(batchReplay.ledger).toEqual({ amount: 123 });
    expect((await archiveEvaluation({ ...f, input: { ...f.batchInput, replay: batchReplay } })).status).toBe("complete");
    for (const [name, contents] of Object.entries(backup)) expect(main[name]).toBe(contents);
    expect(await redactArchivedBaseline(f)).toMatchObject({ status: "unchanged", modifiedFiles: 0 });
    expect(await files(f.primaryRoot)).toEqual(main);
    expect(await files(f.backupRoot)).toEqual(backup);
  });

  it.each(["batch-real", "paid-ledger", "r01", "r04", "r05"])("refuses an existing %s writer lock without modifying data", async (scope) => {
    const f = await fixture();
    const lock = path.join(f.primaryRoot, ".checkpoints", runId, scope, "writer.lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid, hostname: os.hostname() }));
    const before = await files(f.primaryRoot);
    await expect(redactArchivedBaseline(f)).rejects.toThrow("REDACTION_WRITER_LOCKED");
    expect(await files(f.primaryRoot)).toEqual(before);
  });

  it("rejects a junction root and an unsafe run ID", async () => {
    const f = await fixture();
    const alias = path.join(path.dirname(f.primaryRoot), "alias");
    await symlink(f.primaryRoot, alias, process.platform === "win32" ? "junction" : "dir");
    const before = await files(f.primaryRoot);
    await expect(redactArchivedBaseline({ ...f, primaryRoot: alias })).rejects.toThrow("REDACTION_UNSAFE_PATH");
    await expect(redactArchivedBaseline({ ...f, runId: "../outside" })).rejects.toThrow();
    expect(await files(f.primaryRoot)).toEqual(before);
  });

  it("refuses corrupted backup or checkpoint before any replacement", async () => {
    const f = await fixture();
    await writeFile(path.join(f.backupRoot, runId, "r05", "测试问题总结.md"), "foreign bytes");
    const before = await files(f.primaryRoot);
    await expect(redactArchivedBaseline(f)).rejects.toThrow("REDACTION_BACKUP_MISMATCH");
    expect(await files(f.primaryRoot)).toEqual(before);
    const envelopePath = path.join(f.primaryRoot, ".checkpoints", runId, "r01", "checkpoint-00000002.json");
    await writeFile(envelopePath, json({ hash: "0".repeat(64), state: f.states[0] }));
    await expect(redactArchivedBaseline(f)).rejects.toThrow("REDACTION_CHECKPOINT_CORRUPT");
  });

  it("never changes visible dialogue under a nonvisible-candidate authorization", async () => {
    const f = await fixture();
    const state = structuredClone(f.states[0]);
    state.sandbox.messages[0] = { ...state.sandbox.messages[0], content: marker };
    await writeFile(path.join(f.primaryRoot, ".checkpoints", runId, "r01", "checkpoint-00000002.json"), json({ hash: fingerprint(state), state }));
    const before = await files(f.primaryRoot);
    await expect(redactArchivedBaseline(f)).rejects.toThrow("REDACTION_VISIBLE_TEXT_REQUIRES_REVIEW");
    expect(await files(f.primaryRoot)).toEqual(before);
  });
});
