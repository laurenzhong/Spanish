// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseLanguageQualityArgs, runLanguageQualityBatch } from "../../scripts/conversation-evaluation/language-quality-cli";

const sourceRecord = (ordinal: number, candidate: string) => ({
  ordinal, caseId: `d0${ordinal + 1}`, split: "diagnostic", variantId: "full-flash-max", effort: "max", repetition: 0,
  context: { userMessage: "Hola, ¿qué tal?", recentMessages: [], character: {} }, requestHash: null, systemHash: null, inputHash: null,
  text: candidate, gatePassed: true, flags: { contamination: false, englishFragments: [] }, latencyMs: 1, errorCode: null,
});

describe("paid language quality CLI", () => {
  it("reviews a fixed source selection twice per candidate and archives the result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "language-quality-cli-"));
    try {
      const primary = path.join(root, "primary"); const backup = path.join(root, "backup");
      const sourceDir = path.join(primary, "quality-source", "batch-summary"); await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(sourceDir, "回放数据.json"), JSON.stringify({ runId: "quality-source", records: [sourceRecord(0, "Hola."), sourceRecord(1, "Gracias.")] }));
      const requests: Record<string, unknown>[] = [];
      const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>; requests.push(body);
        const system = String(body.system); const candidate = /"candidate":"([^"]+)"/u.exec(system)?.[1] ?? "Hola.";
        const review = { rubricVersion: "language-quality-v1", status: "reviewed", acceptability: "sendable", findings: [], strengths: ["可理解"], limitations: [] };
        expect(system).toContain(candidate);
        return new Response(JSON.stringify({ model: "MiniMax-M3.1-Flash", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(review) }], usage: { input_tokens: 200, output_tokens: 40 } }), { headers: { "x-request-id": "language-quality-fake" } });
      });
      const executeOptions = { ...parseLanguageQualityArgs(["--execute", "--run-id=language-quality-test", "--source-run-id=quality-source", "--limit=2"]),
        repoRoot: process.cwd(), apiKey: "fake-key", primaryRoot: primary, backupRoot: backup, fetchImplementation };
      const first = await runLanguageQualityBatch(executeOptions);
      expect(first).toMatchObject({ status: "completed", planned: 4, count: 4, archive: { status: "complete" } });
      expect(requests).toHaveLength(4);
      const summary = await readFile(path.join(primary, "language-quality-test", "batch-summary", "测试问题总结.md"), "utf8");
      expect(summary).toContain("language-quality-test");
      expect(await readFile(path.join(backup, "language-quality-test", "batch-summary", "回放数据.json"), "utf8")).toContain("quality-source");
      const exported = await runLanguageQualityBatch({ ...executeOptions, ...parseLanguageQualityArgs(["--export-only", "--run-id=language-quality-test", "--source-run-id=quality-source", "--limit=2"]), apiKey: undefined });
      expect(exported).toEqual(first);
      expect(fetchImplementation).toHaveBeenCalledTimes(4);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30000);

  it("freezes explicit source, run and limit options before any paid call", () => {
    expect(parseLanguageQualityArgs(["--execute", "--run-id=language-quality-a", "--source-run-id=quality-a", "--limit=3"])).toMatchObject({ limit: 3, exportOnly: false });
    expect(() => parseLanguageQualityArgs(["--execute", "--run-id=quality-a", "--source-run-id=quality-a"])).toThrow("LANGUAGE_QUALITY_ID_REQUIRED");
    expect(() => parseLanguageQualityArgs(["--execute", "--run-id=language-quality-a", "--source-run-id=quality-a", "--limit=4"])).toThrow("LANGUAGE_QUALITY_LIMIT_INVALID");
    expect(() => parseLanguageQualityArgs(["--execute", "--export-only", "--run-id=language-quality-a", "--source-run-id=quality-a"])).toThrow("EXECUTE_OR_EXPORT_REQUIRED");
  });
});

