// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runQualityProbe, type ProbeCase, type ProbeRecord, type ProbeVariant } from "../../scripts/conversation-evaluation/quality-probe";
import type { EvaluationHttpExecutor } from "../../scripts/conversation-evaluation/real-provider";

const fixture: ProbeCase = { id: "daily", split: "diagnostic", userMessage: "Hola, trabajo en una librería.", recentMessages: [] };
const variants: ProbeVariant[] = [{ id: "baseline", effort: "max" }, { id: "effort-low", effort: "low" },
  { id: "compact", effort: "max", systemOverride: "Responde en español y respeta los datos proporcionados." }];
const response = (text = "Te leo.") => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text }] }));
function options(execute: EvaluationHttpExecutor) {
  return { apiKey: "synthetic-test-key", cases: [fixture], variants, repetitions: 1, execute, persist: async () => {} };
}

describe("controlled generation probes", () => {
  it("compares explicit Flash and M3 using their native provider configurations", async () => {
    const bodies: Record<string, unknown>[] = [];
    const execute = vi.fn<EvaluationHttpExecutor>(async ({ init }) => { bodies.push(JSON.parse(String(init?.body))); return response(); });
    const records = await runQualityProbe({ ...options(execute), variants: [
      { id: "full-flash-max", modelVersion: "MiniMax-M3.1-Flash", effort: "max" },
      { id: "full-m3-native", modelVersion: "MiniMax-M3", effort: "native" },
    ] });
    expect(bodies[0]).toMatchObject({ model: "MiniMax-M3.1-Flash", max_tokens: 4896, output_config: { effort: "max" } });
    expect(bodies[0]).not.toHaveProperty("thinking");
    expect(bodies[1]).toMatchObject({ model: "MiniMax-M3", max_tokens: 800, thinking: { type: "disabled" } });
    expect(bodies[1]).not.toHaveProperty("output_config");
    expect(bodies[1].system).toBe(bodies[0].system);
    expect(bodies[1].messages).toEqual(bodies[0].messages);
    expect(records[0]).toMatchObject({ modelVersion: "MiniMax-M3.1-Flash", effort: "max", requestConfiguration: { modelVersion: "MiniMax-M3.1-Flash", maxTokens: 4896, thinking: "required", effort: "max" } });
    expect(records[1]).toMatchObject({ modelVersion: "MiniMax-M3", effort: "native", requestConfiguration: { modelVersion: "MiniMax-M3", maxTokens: 800, thinking: "disabled", effort: null } });
    expect(records[0].inputHash).toBe(records[1].inputHash);
  });

  it("rejects unsupported or contradictory model configuration before a paid call", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => response());
    for (const variant of [
      { id: "bad", modelVersion: "unknown-model", effort: "max" },
      { id: "bad", modelVersion: "MiniMax-M3", effort: "max" },
      { id: "bad", modelVersion: "MiniMax-M3.1-Flash", effort: "native" },
    ]) await expect(runQualityProbe({ ...options(execute), variants: [variant as ProbeVariant] })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("changes only the selected request variable and keeps model input fixed across arms", async () => {
    const bodies: Record<string, unknown>[] = [];
    const execute = vi.fn<EvaluationHttpExecutor>(async ({ role, input, init }) => {
      expect(role).toBe("character");
      expect(input).toBe("https://api.minimaxi.com/anthropic/v1/messages");
      bodies.push(JSON.parse(String(init?.body)));
      return response();
    });
    const records = await runQualityProbe(options(execute));
    expect(bodies).toHaveLength(3);
    expect(bodies[1]).toEqual({ ...bodies[0], output_config: { effort: "low" } });
    expect(bodies[2]).toEqual({ ...bodies[0], system: variants[2].systemOverride });
    expect(bodies[0]).toMatchObject({ model: "MiniMax-M3.1-Flash", max_tokens: 4896, stream: false });
    expect(new Set(records.map((record) => record.inputHash)).size).toBe(1);
    expect(records[0].requestHash).not.toBe(records[1].requestHash);
    expect(records[0].systemHash).toBe(records[1].systemHash);
    expect(records[0].systemHash).not.toBe(records[2].systemHash);
    const modelInput = JSON.stringify(bodies[0].messages);
    expect(modelInput).not.toContain("diagnostic");
    expect(modelInput).not.toContain("holdout");
    expect(modelInput).not.toContain("baseline");
    expect(records.every((record) => record.gatePassed)).toBe(true);
    expect(records[0]).not.toHaveProperty("modelVersion");
    expect(records[0]).not.toHaveProperty("requestConfiguration");
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0].context.character)).toBe(true);
    expect(records[0].context.character.facts.some((fact) => fact.reveal === "never")).toBe(false);
  });

  it("counterbalances case/repetition order while keeping each case input identical", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => response());
    const records = await runQualityProbe({ ...options(execute), cases: [fixture, { ...fixture, id: "second", split: "holdout" }], repetitions: 2 });
    expect(records.map((record) => record.variantId)).toEqual([
      "baseline", "effort-low", "compact", "effort-low", "compact", "baseline",
      "effort-low", "compact", "baseline", "compact", "baseline", "effort-low",
    ]);
    expect(execute).toHaveBeenCalledTimes(12);
    expect(new Set(records.filter((record) => record.caseId === "daily").map((record) => record.inputHash)).size).toBe(1);
  });

  it("uses the product gate but never makes a paid safety retry", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => response("¿Qué libros te gustan? ¿Qué cocinas?"));
    const persisted: ProbeRecord[] = [];
    const records = await runQualityProbe({ ...options(execute), variants: variants.slice(0, 1), persist: async (record) => { persisted.push(record); } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(records[0]).toMatchObject({ gatePassed: false, errorCode: null });
    expect(persisted).toEqual(records);
  });

  it("discards structured thinking and redacts reasoning leaked into final text before persistence", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [
      { type: "thinking", thinking: "PRIVATE_BLOCK_FIXTURE", signature: "signature" },
      { type: "text", text: "<analysis>PRIVATE_FINAL_FIXTURE</analysis> Hola." },
    ] })));
    const persisted: ProbeRecord[] = [];
    const records = await runQualityProbe({ ...options(execute), variants: variants.slice(0, 1), persist: async (record) => { persisted.push(record); } });
    expect(JSON.stringify(persisted)).not.toContain("PRIVATE_BLOCK_FIXTURE");
    expect(JSON.stringify(persisted)).not.toContain("PRIVATE_FINAL_FIXTURE");
    expect(records[0].text).toContain("SHA-256");
    expect(records[0]).toMatchObject({ gatePassed: false, flags: { contamination: true } });
  });

  it("archives a safe provider error without preserving exception contents", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => { throw new Error("SECRET_ERROR_FIXTURE"); });
    const records = await runQualityProbe({ ...options(execute), variants: variants.slice(0, 1) });
    expect(records[0]).toMatchObject({ text: null, gatePassed: null, errorCode: "provider-unavailable" });
    expect(records[0].requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(records)).not.toContain("SECRET_ERROR_FIXTURE");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("stops on abort, preserving the attempted sample but not starting another arm", async () => {
    const abort = new AbortController();
    const execute = vi.fn<EvaluationHttpExecutor>(async () => { abort.abort(); throw new Error("ABORT_FIXTURE"); });
    const records = await runQualityProbe({ ...options(execute), signal: abort.signal });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].errorCode).toBe("PROBE_CANCELLED");
    const none = await runQualityProbe({ ...options(execute), signal: abort.signal });
    expect(none).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not swallow persistence failure or execute another paid sample", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => response());
    const persist = vi.fn(async () => { throw new Error("PERSISTENCE_FIXTURE"); });
    await expect(runQualityProbe({ ...options(execute), persist })).rejects.toThrow("PERSISTENCE_FIXTURE");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("validates unique fixtures and arms before making any paid request", async () => {
    const execute = vi.fn<EvaluationHttpExecutor>(async () => response());
    await expect(runQualityProbe({ ...options(execute), cases: [fixture, fixture] })).rejects.toThrow("PROBE_DUPLICATE_ID");
    await expect(runQualityProbe({ ...options(execute), variants: [variants[0], variants[0]] })).rejects.toThrow("PROBE_DUPLICATE_ID");
    await expect(runQualityProbe({ ...options(execute), repetitions: 0 })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
