// @vitest-environment node
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeRealManifest, parseRealArgs, runRealBaseline, safetyRetryLimitForRealRun } from "../../scripts/conversation-evaluation/real-cli";
import { coreRoutes } from "../../scripts/conversation-evaluation/routes";
import { runTrajectory } from "../../scripts/conversation-evaluation/runner";

vi.mock("server-only", () => ({}));

describe("real baseline orchestration with fake HTTP only", () => {
  it("requires explicit execution, isolated identity and all real participants", async () => {
    for (const args of [[], ["--execute", "--export-only"], ["--export-only"], ["--execute", "--run-id=offline-a"], ["--execute", "--model=unpriced"]]) expect(() => parseRealArgs(args)).toThrow();
    expect(parseRealArgs(["--resume=baseline-a", "--export-only"])).toMatchObject({ exportOnly: true, resume: true });
    expect(parseRealArgs(["--execute", "--romance-confirmation", "--run-id=baseline-r06"]).romanceConfirmation).toBe(true);
    expect(parseRealArgs(["--execute", "--r04-only", "--run-id=baseline-r04"]).r04Only).toBe(true);
    expect(parseRealArgs(["--execute", "--routes=r01,r05", "--run-id=baseline-r01-r05"]).routes).toEqual(["r01", "r05"]);
    expect(() => parseRealArgs(["--execute", "--routes=r01,r01", "--run-id=baseline-duplicate-routes"])).toThrow("INVALID_ROUTE_SELECTION");
    expect(() => parseRealArgs(["--execute", "--routes=r01,r05", "--r04-only", "--run-id=baseline-route-conflict"])).toThrow("CONFLICTING_ROUTE_SET");
    expect(() => parseRealArgs(["--execute", "--regression", "--romance-confirmation", "--run-id=baseline-conflict"])).toThrow("CONFLICTING_ROUTE_SET");
    const manifest = makeRealManifest("baseline-a", coreRoutes[0], "a".repeat(64));
    expect(manifest.safetyRetryLimit).toBe(1);
    const extended = makeRealManifest("baseline-r04-retry", coreRoutes[1], "a".repeat(64), 2);
    expect(extended.safetyRetryLimit).toBe(2);
    expect(extended.budget.character.maxCalls).toBeGreaterThan(manifest.budget.character.maxCalls);
    expect(safetyRetryLimitForRealRun(parseRealArgs(["--execute", "--routes=r01,r05", "--run-id=baseline-selected"]))).toBe(3);
    expect(safetyRetryLimitForRealRun(parseRealArgs(["--execute", "--run-id=baseline-core"]))).toBe(1);
    await expect(runTrajectory({ manifest, route: coreRoutes[0] })).rejects.toThrow("REAL_PARTICIPANTS_REQUIRED");
  });

  it("records real metadata, keeps per-route invoices stable, and exports without credentials or more HTTP", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "real-baseline-fake-http-"));
    let userCalls = 0, charCalls = 0, reviewCalls = 0;
    const fetchImplementation: typeof fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(init!.body as string) as { max_tokens: number; messages: { content: { text: string }[] }[] };
      const view = JSON.parse(body.messages[0].content[0].text) as { lifeEvent?: string; userMessage?: string; transcript?: unknown[]; turns?: { step: number }[] };
      let text: string;
      if (body.max_tokens === 4352) { userCalls++; text = view.lifeEvent!; }
      else if (body.max_tokens === 5596) { reviewCalls++; text = JSON.stringify({ notes: "仅为注入 HTTP 的集成验证，无真实质量结论。", evidenceSteps: view.turns!.map((t) => t.step), findings: [] }); }
      else {
        const route = coreRoutes[Math.floor(charCalls / 26)];
        const step = route.steps[charCalls % 26];
        charCalls++; text = step.fakeReply;
      }
      return new Response(JSON.stringify({ model: "MiniMax-M3.1-Flash", id: `fixture-${userCalls + charCalls + reviewCalls}`, stop_reason: "end_turn",
        usage: { input_tokens: 123, output_tokens: 234 }, content: [{ type: "thinking", thinking: "never-save-this-thinking" }, { type: "text", text }] }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": `fixture-${userCalls + charCalls + reviewCalls}` } });
    });
    const options = { ...parseRealArgs(["--execute", "--run-id=baseline-fixture"]), primaryRoot: path.join(root, "primary"), backupRoot: path.join(root, "backup"),
      repoRoot: process.cwd(), apiKey: "test-secret-never-save", fetchImplementation };
    const result = await runRealBaseline(options);
    expect(result.results).toHaveLength(4);
    expect(result.results.every((r) => r.status === "complete")).toBe(true);
    expect(result.results.filter((r) => r.state === "completed")).toHaveLength(3);
    expect(userCalls).toBe(0); expect(charCalls).toBe(78); expect(reviewCalls).toBe(6);
    expect(result.billing.calls).toEqual({ user: 0, character: 78, reviewer: 6 });
    expect(result.billing.knownMeasuredCostMicros).toBe(84 * (123 + 234 * 4));
    for (const item of result.results) {
      const json = await readFile(path.join(item.primaryPath, "回放数据.json"), "utf8");
      expect(json).not.toContain("test-secret-never-save"); expect(json).not.toContain("never-save-this-thinking");
      expect(json).toBe(await readFile(path.join(item.backupPath, "回放数据.json"), "utf8"));
    }
    const countsBefore = await readdir(path.join(options.primaryRoot, ".checkpoints", options.runId, "paid-ledger"));
    const exported = await runRealBaseline({ ...options, apiKey: undefined, resume: true, exportOnly: true });
    expect(exported).toEqual(result);
    expect(fetchImplementation).toHaveBeenCalledTimes(84);
    expect(await readdir(path.join(options.primaryRoot, ".checkpoints", options.runId, "paid-ledger"))).toEqual(countsBefore);
  }, 60000);

  it("archives an uncertain request and never calls again on later trajectories or export", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "real-baseline-failure-"));
    const fetchImplementation: typeof fetch = vi.fn(async () => { throw new Error("synthetic network ambiguity"); });
    const options = { ...parseRealArgs(["--execute", "--run-id=baseline-failure"]), primaryRoot: path.join(root, "primary"), backupRoot: path.join(root, "backup"),
      repoRoot: process.cwd(), apiKey: "test", fetchImplementation };
    const result = await runRealBaseline(options);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(result.billing.blockedReason).toBe("AMBIGUOUS_CALL");
    expect(result.results.every((r) => r.status === "complete")).toBe(true);
    expect(result.results.filter((r) => r.state === "failed")).toHaveLength(3);
    expect(await runRealBaseline({ ...options, apiKey: undefined, resume: true, exportOnly: true })).toEqual(result);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  }, 30000);

  it("settles cancelled HTTP accounting before publishing immutable archives", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "real-baseline-cancel-"));
    const abort = new AbortController();
    const fetchImplementation: typeof fetch = vi.fn(async () => {
      abort.abort();
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
    });
    const options = { ...parseRealArgs(["--execute", "--run-id=baseline-cancel"]), primaryRoot: path.join(root, "primary"), backupRoot: path.join(root, "backup"),
      repoRoot: process.cwd(), apiKey: "test", fetchImplementation, signal: abort.signal };
    const result = await runRealBaseline(options);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const raw = await readFile(path.join(result.results[0].primaryPath, "回放数据.json"), "utf8");
    const replay = JSON.parse(raw) as { billing: { entries: { status: string; measuredCostMicros: number | null }[] } };
    expect(replay.billing.entries).toMatchObject([{ status: "uncertain", measuredCostMicros: null }]);
    expect(await runRealBaseline({ ...options, apiKey: undefined, resume: true, exportOnly: true })).toEqual(result);
  }, 30000);
});
