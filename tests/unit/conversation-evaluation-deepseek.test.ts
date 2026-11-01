import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDeepSeekPaidTransport } from "../../scripts/conversation-evaluation/deepseek-paid-transport";
import { createDeepSeekParticipants } from "../../scripts/conversation-evaluation/deepseek-provider";
import { makeDeepSeekManifest, parseDeepSeekArgs, runDeepSeekBaseline } from "../../scripts/conversation-evaluation/deepseek-cli";
import { coreRoutes } from "../../scripts/conversation-evaluation/routes";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "deepseek-test-1" } });
}

describe("DeepSeek evaluation isolation", () => {
  it("requires a fresh deepseek run id and freezes high-reasoning route metadata", () => {
    expect(parseDeepSeekArgs(["--execute", "--run-id=baseline-deepseek-test"]).routes).toEqual(["r01", "r05"]);
    expect(() => parseDeepSeekArgs(["--execute", "--run-id=baseline-test"])).toThrow("DEEPSEEK_BASELINE_ID_REQUIRED");
    expect(parseDeepSeekArgs(["--execute", "--routes=r05", "--run-id=baseline-deepseek-r05"]).routes).toEqual(["r05"]);
    expect(parseDeepSeekArgs(["--execute", "--routes=r04", "--run-id=baseline-deepseek-r04"]).routes).toEqual(["r04"]);
    const manifest = makeDeepSeekManifest("baseline-deepseek-test", coreRoutes[0], "a".repeat(64));
    expect(manifest.participants).toEqual({ user: "scripted-user-v2", character: "DeepSeek/deepseek-flash/product", reviewer: "DeepSeek/deepseek-flash/reviewer-v1" });
    expect(manifest.safetyRetryLimit).toBe(3);
    expect(manifest.maxCostMicros).toBe(7_562_784);
  });

  it("sends only the allowlisted DeepSeek request and records usage without inventing price", async () => {
    const durable: unknown[] = [];
    let seen: RequestInit | undefined;
    const transport = createDeepSeekPaidTransport({ apiKey: "secret-key", persist: async (ledger) => { durable.push(ledger); }, fetchImplementation: vi.fn(async (_url, init) => {
      seen = init; return response({ model: "deepseek-flash", id: "req-1", usage: { prompt_tokens: 10, completion_tokens: 4 }, choices: [{ message: { content: "Hola." }, finish_reason: "stop" }] });
    }) });
    const result = await transport.execute({ role: "character", input: "https://api.deepseek.com/v1/chat/completions", scope: { trajectoryId: "r01", step: 0 }, init: {
      method: "POST", headers: { authorization: "hostile" }, body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "visible" }], max_tokens: 4896, reasoning_effort: "high", stream: false }),
    } });
    expect((await result.json()).choices[0].message.content).toBe("Hola.");
    expect((seen?.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
    expect(transport.snapshot().entries[0]).toMatchObject({ status: "received", model: "deepseek-flash", requestId: "req-1", usage: { input_tokens: 10, output_tokens: 4 }, measuredCostMicros: null });
    expect(JSON.stringify(durable)).not.toContain("secret-key");
  });

  it("maps DeepSeek chat completion text and keeps reviewer quotes step-bound", async () => {
    const calls: RequestInit[] = [];
    const participants = createDeepSeekParticipants({ apiKey: "key", userMode: "scripted", execute: vi.fn(async ({ init }) => {
      calls.push(init ?? {});
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[]; max_tokens: number };
      if (body.max_tokens === 4896) return response({ choices: [{ message: { content: "Respuesta en español." }, finish_reason: "stop" }] });
      return response({ choices: [{ message: { content: JSON.stringify({ notes: "仅为契约测试。", evidenceSteps: [0], findings: [{ severity: "low", category: "language", step: 0, quote: "Respuesta en español.", issue: "测试" }] }) }, finish_reason: "stop" }] });
    }) });
    const input = { userMessage: "Hola", recentMessages: [], character: { characterKey: "lucia", characterVersion: 1, displayName: "Lucía", homeLocation: "Madrid", initiative: "balanced" as const, tone: ["natural"], topics: ["cocina"], facts: [] }, relationshipStage: "new_contact" as const, relationshipSummary: null, memories: [], teachingOpportunity: null };
    const character = await participants.character(input, new AbortController().signal);
    expect(character.text).toBe("Respuesta en español.");
    const review = await participants.reviewer({ expectedOutcome: "", mustAvoid: [], transcript: [{ role: "character", content: "Respuesta en español.", at: "2026-01-01T00:00:00.000Z", status: "sent", step: 0 }], turns: [{ step: 0, session: 1, at: "2026-01-01T00:00:00.000Z", kind: "user", generationId: "g", done: true, result: "Respuesta en español.", memoryCountBefore: 0, memoryCountAfter: 0, stageBefore: "new_contact", stageAfter: "new_contact" }], limitations: [] }, 0, new AbortController().signal);
    expect(review.findings).toHaveLength(1);
    expect(calls.every((init) => JSON.stringify(init.body).includes("reasoning_effort"))).toBe(true);
  });

  it("archives an export-only result without network calls", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deepseek-eval-export-"));
    const args = parseDeepSeekArgs(["--execute", "--run-id=baseline-deepseek-export", "--primary-root=" + path.join(root, "primary"), "--backup-root=" + path.join(root, "backup")]);
    const fetchImplementation = vi.fn<typeof fetch>(async () => response({}));
    const executed = await runDeepSeekBaseline({ ...args, repoRoot: process.cwd(), apiKey: "key", fetchImplementation });
    expect(executed.results).toHaveLength(3);
    const exported = await runDeepSeekBaseline({ ...parseDeepSeekArgs(["--export-only", "--resume=baseline-deepseek-export", "--primary-root=" + path.join(root, "primary"), "--backup-root=" + path.join(root, "backup")]), repoRoot: process.cwd(), fetchImplementation });
    expect(exported.runId).toBe(executed.runId);
    expect(fetchImplementation).toHaveBeenCalled();
    const ledgerDirectory = path.join(root, "primary", ".checkpoints", "baseline-deepseek-export", "paid-ledger-deepseek");
    const { readdir } = await import("node:fs/promises");
    const ledgerFile = (await readdir(ledgerDirectory)).find((name) => name.startsWith("checkpoint-") && name.endsWith(".json"));
    expect(ledgerFile).toBeDefined();
    expect(await readFile(path.join(ledgerDirectory, ledgerFile!), "utf8")).toContain("deepseek");
  }, 120000);
});

