// @vitest-environment node
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvaluationArgs, runEvaluationBatch } from "../../scripts/conversation-evaluation/cli";

describe("offline evaluation CLI", () => {
  it("rejects paid modes, ambiguous flags and unsafe identities", () => {
    for (const args of [["--real"], ["--mode=real"], ["--run-id=../bad"], ["--export-only"], ["--resume=a", "--run-id=b"], ["--resume=a", "--resume=b"]]) {
      expect(() => parseEvaluationArgs(args)).toThrow();
    }
    expect(parseEvaluationArgs(["--resume=run-a", "--export-only"])).toMatchObject({ runId: "run-a", resume: true, exportOnly: true });
  });

  it("runs three isolated routes, preserves both archives, and exports again without appending checkpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "evaluation-cli-"));
    const options = { ...parseEvaluationArgs(["--run-id=cli-fixture"]), primaryRoot: path.join(root, "primary"), backupRoot: path.join(root, "backup"), repoRoot: process.cwd() };
    const result = await runEvaluationBatch(options);
    expect(result.results).toHaveLength(4);
    expect(result.results.every((r) => r.status === "complete")).toBe(true);
    for (const item of result.results) {
      expect(["completed", "index"]).toContain(item.state);
      for (const file of ["聊天记录.md", "测试问题总结.md", "回放数据.json", "归档清单.json"]) {
        expect(await readFile(path.join(item.primaryPath, file), "utf8")).toBe(await readFile(path.join(item.backupPath, file), "utf8"));
      }
    }
    const directory = path.join(options.primaryRoot, ".checkpoints", options.runId, "r01");
    const files = await readdir(directory);
    const replay = JSON.parse(await readFile(path.join(result.results[0].primaryPath, "回放数据.json"), "utf8")) as { checkpoint: { cursor: number; sandbox: { messages: unknown[] }; reviews: { verdict: string }[] } };
    expect(replay.checkpoint.cursor).toBe(26);
    expect(replay.checkpoint.sandbox.messages.length).toBeGreaterThanOrEqual(49);
    expect(replay.checkpoint.reviews.every((r) => r.verdict === "not_evaluated")).toBe(true);
    const second = await runEvaluationBatch({ ...options, resume: true, exportOnly: true });
    expect(second).toEqual(result);
    expect(await readdir(directory)).toEqual(files);
    await expect(runEvaluationBatch(options)).rejects.toThrow("RUN_EXISTS_USE_RESUME_OR_NEW_ID");
  }, 60000);

  it("archives cancellation and keeps terminal export bytes stable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "evaluation-cli-cancel-"));
    const abort = new AbortController(); abort.abort();
    const options = { ...parseEvaluationArgs(["--run-id=cancel-fixture"]), primaryRoot: path.join(root, "primary"), backupRoot: path.join(root, "backup"), repoRoot: process.cwd(), signal: abort.signal };
    const first = await runEvaluationBatch(options);
    expect(first.results.filter((r) => r.state === "cancelled")).toHaveLength(3);
    expect(first.results.every((r) => r.status === "complete")).toBe(true);
    const second = await runEvaluationBatch({ ...options, resume: true, exportOnly: true });
    expect(second).toEqual(first);
  }, 30000);
});
