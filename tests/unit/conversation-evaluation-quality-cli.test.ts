// @vitest-environment node
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseQualityArgs, runQualityBatch } from "../../scripts/conversation-evaluation/quality-cli";

describe("controlled quality CLI", () => {
  it("requires an explicit model experiment and a recorded-candidate identifier for its holdout", () => {
    expect(parseQualityArgs(["--execute", "--run-id=quality-models", "--experiment=models"])).toMatchObject({ experiment: "models", phase: "diagnostic" });
    expect(() => parseQualityArgs(["--execute", "--run-id=quality-models", "--experiment=unknown"])).toThrow();
    expect(() => parseQualityArgs(["--execute", "--run-id=quality-models", "--experiment=models", "--phase=holdout"])).toThrow();
    expect(() => parseQualityArgs(["--execute", "--run-id=quality-models", "--experiment=models", "--phase=holdout", "--candidate=compact-max"])).toThrow();
    expect(parseQualityArgs(["--execute", "--run-id=quality-models", "--experiment=models", "--phase=holdout", "--candidate=full-m3-native"])).toMatchObject({ experiment: "models", candidate: "full-m3-native" });
  });

  it("freezes model v3, native settings and policy while exporting from stored state rather than current options", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "quality-models-"));
    try {
      const requests: Record<string, unknown>[] = [];
      const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
        const body = JSON.parse(String(init?.body)); requests.push(body);
        return new Response(JSON.stringify({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: "De acuerdo." }],
          usage: { input_tokens: 100, output_tokens: 8 } }), { headers: { "x-request-id": "fake-model-quality" } });
      });
      const options = { ...parseQualityArgs(["--execute", "--run-id=quality-models", "--experiment=models"]), repoRoot: process.cwd(), apiKey: "fake",
        primaryRoot: path.join(root, "primary"), backupRoot: path.join(root, "backup"), fetchImplementation };
      const first = await runQualityBatch(options);
      expect(first).toMatchObject({ status: "completed", planned: 24, count: 24, archive: { status: "complete" } });
      expect(requests.filter(body => body.model === "MiniMax-M3")).toHaveLength(12);
      expect(requests.filter(body => body.model === "MiniMax-M3.1-Flash")).toHaveLength(12);
      for (const body of requests.filter(body => body.model === "MiniMax-M3")) {
        expect(body).toMatchObject({ max_tokens: 800, thinking: { type: "disabled" } });
        expect(body).not.toHaveProperty("output_config");
      }
      const replayPath = path.join(root, "primary", "quality-models", "batch-summary", "回放数据.json");
      const before = await readFile(replayPath, "utf8");
      const state = JSON.parse(before);
      expect(state).toMatchObject({ version: 3, experiment: "models", transportPolicy: { modelPolicy: "flash-m3-v1", ceilingMicros: 1534632 } });
      expect(state.source.sources.some((source: { file: string }) => source.file === "scripts/run-conversation-quality.ts")).toBe(true);
      expect(state.variants).toEqual([{ id: "full-flash-max", effort: "max", modelVersion: "MiniMax-M3.1-Flash" },
        { id: "full-m3-native", effort: "native", modelVersion: "MiniMax-M3" }]);
      expect(state.records.find((record: { modelVersion?: string }) => record.modelVersion === "MiniMax-M3").requestConfiguration)
        .toEqual({ modelVersion: "MiniMax-M3", maxTokens: 800, thinking: "disabled", effort: null });
      const exported = await runQualityBatch({ ...options, ...parseQualityArgs(["--export-only", "--run-id=quality-models"]), apiKey: undefined });
      expect(exported).toEqual(first);
      expect(await readFile(replayPath, "utf8")).toBe(before);
      expect(fetchImplementation).toHaveBeenCalledTimes(24);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30000);
  it("requires explicit execution, unique options and a real holdout candidate", () => {
    expect(() => parseQualityArgs(["--run-id=quality-test"])).toThrow();
    expect(() => parseQualityArgs(["--execute", "--run-id=quality-test", "--phase=holdout"])).toThrow();
    expect(() => parseQualityArgs(["--execute", "--run-id=quality-test", "--phase=holdout", "--candidate=full-max"])).toThrow();
    expect(() => parseQualityArgs(["--execute", "--execute", "--run-id=quality-test"])).toThrow();
    expect(parseQualityArgs(["--execute", "--run-id=quality-test", "--phase=holdout", "--candidate=compact-max"])).toMatchObject({phase:"holdout",candidate:"compact-max"});
  });
  it("archives every fixed sample with fake HTTP and refuses paid replay while allowing pure export", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "quality-cli-"));
    try {
      const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        model: "MiniMax-M3.1-Flash", stop_reason: "end_turn", content: [{type:"text",text:"De acuerdo."}], usage:{input_tokens:100,output_tokens:8},
      }), {headers:{"x-request-id":"fake-quality"}}));
      const options = { ...parseQualityArgs(["--execute", "--run-id=quality-test"]), repoRoot:process.cwd(),apiKey:"fake",
        primaryRoot:path.join(root,"primary"),backupRoot:path.join(root,"backup"),fetchImplementation };
      const first = await runQualityBatch(options);
      expect(first).toMatchObject({status:"completed",count:48,archive:{status:"complete"}});
      expect(fetchImplementation).toHaveBeenCalledTimes(48);
      const manifest = JSON.parse(await readFile(path.join(root,"primary","quality-test","batch-summary","归档清单.json"),"utf8"));
      expect(manifest.messageCount).toBe(176);
      const summary = await readFile(path.join(root,"primary","quality-test","batch-summary","测试问题总结.md"),"utf8");
      expect(summary).toContain("未知计费 0");
      await expect(runQualityBatch(options)).rejects.toThrow("QUALITY_RUN_EXISTS_EXPORT_ONLY");
      const exported = await runQualityBatch({...options,apiKey:undefined,exportOnly:true});
      expect(exported).toEqual(first);
      expect(fetchImplementation).toHaveBeenCalledTimes(48);
    } finally { await rm(root,{recursive:true,force:true}); }
  }, 30000);
});
