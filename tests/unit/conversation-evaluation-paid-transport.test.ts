// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPaidTransport, type PaidLedger } from "../../scripts/conversation-evaluation/paid-transport";

const endpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const model = "MiniMax-M3.1-Flash";
const duration = 30 * 60 * 1000;
const request = (extra: Record<string, unknown> = {}) => ({
  role: "user" as const, input: endpoint,
  init: { method: "POST", body: JSON.stringify({ model, max_tokens: 4352, stream: false, messages: [{ role: "user", content: "Hola" }], ...extra }) },
});
const response = (extra: Record<string, unknown> = {}, status = 200) => Response.json({
  model, id: "msg-1", content: [{ type: "thinking", thinking: "never-persist-this" }, { type: "text", text: "Hola" }],
  usage: { input_tokens: 100, output_tokens: 20 }, ...extra,
}, { status, headers: { "request-id": "req-1" } });
function setup(overrides: Partial<Parameters<typeof createPaidTransport>[0]> = {}) {
  const durable: PaidLedger[] = [];
  const network = vi.fn<typeof fetch>(async () => response());
  const transport = createPaidTransport({ apiKey: "private-key", now: () => 1000, fetchImplementation: network,
    persist: async (ledger) => { durable.push(ledger); }, ...overrides });
  return { ...transport, durable, network };
}
function reseal(ledger: PaidLedger) {
  const { ledgerHash: _hash, ...contents } = ledger;
  void _hash;
  return { ...contents, ledgerHash: createHash("sha256").update(JSON.stringify(contents)).digest("hex") };
}

describe("paid evaluation transport without paid requests", () => {
  it("preserves the legacy Flash policy hash and exact empty ledger bytes", () => {
    const legacy = '{"formatVersion":1,"policyHash":"0699688dac1720e8b6dcb0b4c678eeeab212f259ac91dced0e876773412f0ff2","createdAt":1000,"deadlineAt":1801000,"reservedCostMicros":0,"calls":{"user":0,"character":0,"reviewer":0},"blockedReason":null,"entries":[],"ledgerHash":"97536cf037eb75b261bae1220718184cf7fc384353c43a99d99da671e7d01c80"}';
    expect(JSON.stringify(setup().snapshot())).toBe(legacy);
    expect(JSON.stringify(setup({ prior: JSON.parse(legacy) }).snapshot())).toBe(legacy);
  });

  it("keeps completed legacy Flash entries byte-compatible without a requestedModel field", async () => {
    const t = setup(); await t.execute(request());
    const priorBytes = JSON.stringify(t.snapshot());
    expect(priorBytes).not.toContain("requestedModel");
    expect(JSON.stringify(setup({ prior: JSON.parse(priorBytes) }).snapshot())).toBe(priorBytes);
    expect(t.snapshot().policyHash).toBe("0699688dac1720e8b6dcb0b4c678eeeab212f259ac91dced0e876773412f0ff2");
  });

  it("reserves and measures mixed Flash/M3 calls at their own prices under the explicit policy", async () => {
    const network = vi.fn<typeof fetch>(async (_url, init) => response({ model: JSON.parse(String(init?.body)).model }));
    const t = setup({ modelPolicy: "flash-m3-v1", fetchImplementation: network });
    await t.execute({ ...request({ max_tokens: 4896 }), role: "character" });
    await t.execute({ ...request({ model: "MiniMax-M3", max_tokens: 800 }), role: "character" });
    const [flash, m3] = t.snapshot().entries;
    expect(flash).toMatchObject({ requestedModel: model, measuredCostMicros: 180 });
    expect(m3).toMatchObject({ requestedModel: "MiniMax-M3", model: "MiniMax-M3", measuredCostMicros: 378 });
    expect(flash.reservedCostMicros).toBe(flash.inputBound + 4896 * 4);
    expect(m3.reservedCostMicros).toBe(Math.round(m3.inputBound * 2.1 + 800 * 8.4));
    expect(t.snapshot().reservedCostMicros).toBe(flash.reservedCostMicros + m3.reservedCostMicros);
    expect(JSON.stringify(setup({ modelPolicy: "flash-m3-v1", prior: t.snapshot() }).snapshot())).toBe(JSON.stringify(t.snapshot()));
    expect(t.durable[0].entries[0].requestedModel).toBe(model);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["user", "MiniMax-M3", 800], ["reviewer", "MiniMax-M3", 800], ["character", "MiniMax-M3", 801],
    ["character", "unknown-model", 800], ["character", model, 4897],
  ] as const)("rejects unsupported policy request %s / %s / %i before reservation", async (role, requestedModel, output) => {
    const t = setup({ modelPolicy: "flash-m3-v1" });
    await expect(t.execute({ ...request({ model: requestedModel, max_tokens: output }), role })).rejects.toThrow("REQUEST_NOT_ALLOWED");
    expect(t.network).not.toHaveBeenCalled();
    expect(t.snapshot().entries).toHaveLength(0);
  });

  it.each([
    { service_tier: "priority" }, { priority: true }, { cache_control: { type: "ephemeral" } },
    { system: [{ type: "text", text: "Hola", cache_control: { type: "ephemeral" } }] },
    { messages: [{ role: "user", content: [{ type: "text", text: "Hola", cache_control: { type: "ephemeral" } }] }] },
    { messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/image" } }] }] },
    { output_config: { effort: "max", service_tier: "priority" } }, { tools: [{ type: "web_search" }] },
  ])("rejects unpriced request extensions %# only under the new policy", async (extra) => {
    const t = setup({ modelPolicy: "flash-m3-v1" });
    await expect(t.execute(request(extra))).rejects.toThrow("REQUEST_NOT_ALLOWED");
    expect(t.network).not.toHaveBeenCalled();
    expect(t.snapshot().entries).toHaveLength(0);
    const legacy = setup(); await legacy.execute(request(extra));
    expect(legacy.network).toHaveBeenCalledTimes(1);
  });

  it("accepts the native Flash maximum effort and disabled-thinking M3 text request shapes", async () => {
    const t = setup({ modelPolicy: "flash-m3-v1", fetchImplementation: async (_url, init) => response({ model: JSON.parse(String(init?.body)).model }) });
    const messages = [{ role: "user", content: [{ type: "text", text: 'Literal untrusted text may mention {"cache_control":true}.' }] }];
    await t.execute({ ...request({ max_tokens: 4896, output_config: { effort: "max" }, system: "Responde en español.", messages }), role: "character" });
    await t.execute({ ...request({ model: "MiniMax-M3", max_tokens: 800, thinking: { type: "disabled" }, system: [{ type: "text", text: "Responde en español." }], messages }), role: "character" });
    expect(t.snapshot().entries).toHaveLength(2);
  });

  it.each([undefined, "MiniMax-M3", "unknown-model"])("blocks missing or wrong returned model %s without reporting an assumed charge", async (returnedModel) => {
    const network = vi.fn<typeof fetch>(async () => response({ model: returnedModel }));
    const t = setup({ modelPolicy: "flash-m3-v1", fetchImplementation: network });
    await expect(t.execute(request())).rejects.toThrow("MODEL_MISMATCH");
    expect(t.snapshot().entries[0]).toMatchObject({ requestedModel: model, errorCode: "MODEL_MISMATCH", measuredCostMicros: null });
    expect(t.snapshot().reservedCostMicros).toBeGreaterThan(0);
    await expect(t.execute(request())).rejects.toThrow("MODEL_MISMATCH");
    const resumed = setup({ modelPolicy: "flash-m3-v1", prior: t.snapshot() });
    await expect(resumed.execute(request())).rejects.toThrow("MODEL_MISMATCH");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("keeps M3 usage unknown without losing its known requested/returned model", async () => {
    const t = setup({ modelPolicy: "flash-m3-v1", fetchImplementation: async () => response({ model: "MiniMax-M3", usage: { input_tokens: -1, output_tokens: 3 } }) });
    await t.execute({ ...request({ model: "MiniMax-M3", max_tokens: 800 }), role: "character" });
    expect(t.snapshot().entries[0]).toMatchObject({ requestedModel: "MiniMax-M3", model: "MiniMax-M3", usage: null, measuredCostMicros: null, errorCode: "USAGE_UNKNOWN" });
    expect(t.snapshot().blockedReason).toBeNull();
  });

  it("binds a lower ceiling to the policy and prevents reservations beyond it", async () => {
    const call = { ...request({ model: "MiniMax-M3", max_tokens: 800 }), role: "character" as const };
    const reserved = Math.round((Buffer.byteLength(call.init.body) + 1024) * 2.1 + 800 * 8.4);
    const t = setup({ modelPolicy: "flash-m3-v1", ceilingMicros: reserved, fetchImplementation: async () => response({ model: "MiniMax-M3" }) });
    await t.execute(call);
    await expect(t.execute(call)).rejects.toThrow("PAID_BUDGET_EXHAUSTED");
    expect(t.snapshot().reservedCostMicros).toBe(reserved);
    expect(() => setup({ modelPolicy: "flash-m3-v1", prior: t.snapshot() })).toThrow("INVALID_PAID_LEDGER");
    expect(setup({ modelPolicy: "flash-m3-v1", ceilingMicros: reserved, prior: t.snapshot() }).snapshot()).toEqual(t.snapshot());
    expect(setup({ modelPolicy: "flash-m3-v1", ceilingMicros: 1534632 }).snapshot().policyHash).not.toBe(setup({ modelPolicy: "flash-m3-v1" }).snapshot().policyHash);
  });

  it.each([-1, 7562785, 0.5, Number.NaN])("rejects invalid hard ceiling %s", (ceilingMicros) => {
    expect(() => setup({ modelPolicy: "flash-m3-v1", ceilingMicros })).toThrow("INVALID_PAID_POLICY");
  });

  it("rejects incompatible policy and missing/tampered per-entry requested model on restore", async () => {
    const t = setup({ modelPolicy: "flash-m3-v1", fetchImplementation: async () => response({ model: "MiniMax-M3" }) });
    await t.execute({ ...request({ model: "MiniMax-M3", max_tokens: 800 }), role: "character" });
    expect(() => setup({ prior: t.snapshot() })).toThrow("INVALID_PAID_LEDGER");
    const missing = t.snapshot(); delete missing.entries[0].requestedModel;
    expect(() => setup({ modelPolicy: "flash-m3-v1", prior: reseal(missing) })).toThrow("INVALID_PAID_LEDGER");
    const changed = t.snapshot(); changed.entries[0].requestedModel = model;
    expect(() => setup({ modelPolicy: "flash-m3-v1", prior: reseal(changed) })).toThrow("INVALID_PAID_LEDGER");
    expect(() => setup({ modelPolicy: "flash-m3-v1", prior: setup().snapshot() })).toThrow("INVALID_PAID_LEDGER");
    const wrongCharge = t.snapshot(); wrongCharge.entries[0].measuredCostMicros = 180;
    expect(() => setup({ modelPolicy: "flash-m3-v1", prior: reseal(wrongCharge) })).toThrow("INVALID_PAID_LEDGER");
    const wrongRole = t.snapshot(); wrongRole.entries[0].role = "user"; wrongRole.calls.character = 0; wrongRole.calls.user = 1;
    expect(() => setup({ modelPolicy: "flash-m3-v1", prior: reseal(wrongRole) })).toThrow("INVALID_PAID_LEDGER");
  });

  it("durably reserves before dispatch, pins credentials and records measured usage separately", async () => {
    const durable: PaidLedger[] = [];
    const network = vi.fn<typeof fetch>(async (_input, init) => {
      expect(durable).toHaveLength(1);
      expect(durable[0].entries[0].status).toBe("reserved");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("private-key");
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      return response({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 } });
    });
    const t = setup({ fetchImplementation: network, persist: async (ledger) => { durable.push(ledger); } });
    const call = request();
    const result = await t.execute({ ...call, scope: { trajectoryId: "r01-real", step: 3 }, init: { ...call.init, headers: { "x-api-key": "hostile", authorization: "do-not-forward" } } });
    expect((await result.json()).content[1].text).toBe("Hola");
    expect(durable).toHaveLength(2);
    const entry = t.snapshot().entries[0];
    expect(entry.inputBound).toBe(Buffer.byteLength(call.init.body) + 1024);
    expect(entry.reservedCostMicros).toBe(entry.inputBound + 4 * 4352);
    expect(entry.measuredCostMicros).toBe(180);
    expect(entry.scope).toEqual({ trajectoryId: "r01-real", step: 3 });
    expect(entry.requestId).toBe("req-1");
    expect(entry.status).toBe("received");
    expect(JSON.stringify(durable)).not.toMatch(/private-key|hostile|never-persist-this|Hola/u);
    expect(t.snapshot().deadlineAt).toBe(1000 + duration);
  });

  it.each([
    { input: "https://example.com/anthropic/v1/messages" },
    { input: `${endpoint}?redirect=1` },
    { init: { method: "PUT", body: request().init.body } },
    { init: request({ model: "MiniMax-M3" }).init },
    { init: request({ stream: true }).init },
    { init: request({ max_tokens: 4353 }).init },
    { init: request({ max_tokens: 0 }).init },
    { scope: { trajectoryId: "../secret", step: 0 } },
  ])("rejects invalid preflight %# without reservation or network", async (change) => {
    const t = setup();
    await expect(t.execute({ ...request(), ...change })).rejects.toThrow();
    expect(t.network).not.toHaveBeenCalled(); expect(t.durable).toHaveLength(0);
    expect(t.snapshot().reservedCostMicros).toBe(0);
  });

  it.each([["user", 12000, 4352], ["character", 32768, 4896], ["reviewer", 64000, 5596]] as const)("persists a terminal %s input-bound block before any reservation", async (role, cap, output) => {
    const t = setup();
    await expect(t.execute({ ...request({ messages: "汉".repeat(cap), max_tokens: output }), role })).rejects.toThrow("INPUT_BOUND_EXCEEDED");
    expect(t.durable.at(-1)?.blockedReason).toBe("INPUT_BOUND_EXCEEDED");
    expect(t.snapshot().entries).toHaveLength(0);
    expect(t.snapshot().reservedCostMicros).toBe(0);
    await expect(t.execute(request())).rejects.toThrow("INPUT_BOUND_EXCEEDED");
    expect(t.network).not.toHaveBeenCalled();
  });

  it.each([undefined, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 2.5, output_tokens: 1 }, { input_tokens: 10 }])("keeps missing or invalid usage unknown: %j", async (usage) => {
    const t = setup({ fetchImplementation: async () => response({ usage }) });
    await t.execute(request());
    expect(t.snapshot().entries[0]).toMatchObject({ status: "received", usage: null, measuredCostMicros: null, errorCode: "USAGE_UNKNOWN" });
    expect(t.snapshot().reservedCostMicros).toBeGreaterThan(0);
  });

  it("keeps HTTP failure usage unknown and does not retry", async () => {
    const network = vi.fn<typeof fetch>(async () => response({}, 429));
    const t = setup({ fetchImplementation: network });
    expect((await t.execute(request())).status).toBe(429);
    expect(t.snapshot().entries[0]).toMatchObject({ usage: null, measuredCostMicros: null, errorCode: "HTTP_ERROR" });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("never dispatches an already aborted or expired request", async () => {
    const controller = new AbortController(); controller.abort();
    const cancelled = setup({ signal: controller.signal });
    await expect(cancelled.execute(request())).rejects.toThrow("CANCELLED");
    expect(cancelled.network).not.toHaveBeenCalled();
    expect(cancelled.snapshot().entries).toHaveLength(0);
    let clock = 1000;
    const expired = setup({ now: () => clock }); clock += duration;
    await expect(expired.execute(request())).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(expired.network).not.toHaveBeenCalled();
    expect(expired.snapshot().entries).toHaveLength(0);
    expect(expired.durable.at(-1)?.blockedReason).toBe("DEADLINE_EXCEEDED");
  });

  it("retains unknown charge after network failure and sanitizes provider error details", async () => {
    const network = vi.fn<typeof fetch>(async () => { throw new Error("private-key and request text"); });
    const t = setup({ fetchImplementation: network });
    await expect(t.execute(request())).rejects.toThrow("NETWORK_UNCERTAIN");
    expect(t.snapshot().entries[0]).toMatchObject({ status: "uncertain", usage: null, measuredCostMicros: null });
    expect(JSON.stringify(t.snapshot())).not.toContain("private-key");
    const resumed = setup({ prior: t.snapshot() });
    await expect(resumed.execute(request())).rejects.toThrow("AMBIGUOUS_CALL");
    expect(resumed.network).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("returns an unparseable response with unknown usage rather than a fabricated zero charge", async () => {
    const t = setup({ fetchImplementation: async () => new Response("not JSON") });
    expect(await (await t.execute(request())).text()).toBe("not JSON");
    expect(t.snapshot().entries[0]).toMatchObject({ usage: null, measuredCostMicros: null, errorCode: "USAGE_UNKNOWN" });
  });

  it.each(["input", "output", "model"] as const)("records and blocks a %s billing violation", async (kind) => {
    const network = vi.fn<typeof fetch>(async () => response(kind === "model" ? { model: "MiniMax-M3" }
      : { usage: { input_tokens: kind === "input" ? 50000 : 100, output_tokens: kind === "output" ? 4353 : 20 } }));
    const t = setup({ fetchImplementation: network });
    await expect(t.execute(request())).rejects.toThrow(kind === "model" ? "MODEL_MISMATCH" : "USAGE_BOUND_EXCEEDED");
    await expect(t.execute(request())).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
    expect(t.snapshot().blockedReason).not.toBeNull();
  });

  it("retains a reservation when cancelled during persistence, without dispatch", async () => {
    const controller = new AbortController();
    const t = setup({ signal: controller.signal, persist: async () => { controller.abort(); } });
    await expect(t.execute(request())).rejects.toThrow("CANCELLED");
    expect(t.network).not.toHaveBeenCalled();
    expect(t.snapshot().entries[0]).toMatchObject({ status: "not_sent", usage: null, measuredCostMicros: null, errorCode: "CANCELLED" });
    expect(t.snapshot().calls.user).toBe(1);
    expect(t.snapshot().reservedCostMicros).toBeGreaterThan(0);
  });

  it("rechecks deadline after persistence and never refunds the reserved budget", async () => {
    let clock = 1000;
    const t = setup({ now: () => clock, persist: async () => { clock = 1000 + duration; } });
    await expect(t.execute(request())).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(t.network).not.toHaveBeenCalled();
    expect(t.snapshot().entries[0].status).toBe("not_sent");
    expect(t.snapshot().blockedReason).toBe("DEADLINE_EXCEEDED");
  });

  it("bounds an uncooperative fetch with the remaining wall deadline", async () => {
    let clock = 1000;
    const network = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
    const t = setup({ now: () => clock, fetchImplementation: network });
    clock += duration - 20;
    await expect(t.execute(request())).rejects.toThrow("REQUEST_TIMEOUT");
    expect(t.snapshot().entries[0]).toMatchObject({ status: "uncertain", usage: null, measuredCostMicros: null });
    await expect(t.execute(request())).rejects.toThrow("AMBIGUOUS_CALL");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])("fails closed on persistence failure %i and refuses further calls", async (failureAt) => {
    let writes = 0;
    const t = setup({ persist: async () => { if (++writes === failureAt) throw new Error("secret disk path"); } });
    await expect(t.execute(request())).rejects.toThrow("PERSISTENCE_UNCERTAIN");
    await expect(t.execute(request())).rejects.toThrow("PERSISTENCE_UNCERTAIN");
    expect(t.network).toHaveBeenCalledTimes(failureAt - 1);
    expect(JSON.stringify(t.snapshot())).not.toContain("secret disk path");
  });

  it("refuses ambiguous restored reservations without another network request", async () => {
    let durable: PaidLedger | undefined;
    const t = setup({ persist: async (ledger) => { durable = ledger; throw new Error("crash"); } });
    await expect(t.execute(request())).rejects.toThrow();
    const resumed = setup({ prior: durable });
    await expect(resumed.execute(request())).rejects.toThrow("AMBIGUOUS_CALL");
    expect(resumed.network).not.toHaveBeenCalled();
    expect(resumed.snapshot().reservedCostMicros).toBe(durable!.reservedCostMicros);
  });

  it("validates version, hash, counts and reservation consistency on recovery", async () => {
    const t = setup(); await t.execute(request());
    const good = t.snapshot();
    expect(setup({ prior: JSON.parse(JSON.stringify(good)) }).snapshot()).toEqual(good);
    expect(() => setup({ prior: { ...good, formatVersion: 2 } })).toThrow();
    expect(() => setup({ prior: { ...good, createdAt: 99 } })).toThrow();
    expect(() => setup({ prior: reseal({ ...good, calls: { ...good.calls, user: 0 } }) })).toThrow();
    expect(() => setup({ prior: reseal({ ...good, reservedCostMicros: 1 }) })).toThrow();
    expect(() => setup({ prior: { ...good, apiKey: "not-allowed" } })).toThrow();
  });

  it.each([["user", 72, 4352], ["character", 156, 4896], ["reviewer", 6, 5596]] as const)("enforces the %s call ceiling", async (role, cap, output) => {
    const t = setup();
    for (let index = 0; index < cap; index++) await t.execute({ ...request({ max_tokens: output }), role });
    await expect(t.execute({ ...request({ max_tokens: output }), role })).rejects.toThrow("PAID_BUDGET_EXHAUSTED");
    expect(t.network).toHaveBeenCalledTimes(cap);
    expect(t.snapshot().calls[role]).toBe(cap);
    expect(t.durable.at(-1)?.blockedReason).toBe("PAID_BUDGET_EXHAUSTED");
  });

  it("enforces the global reservation ceiling before exhausting character call slots", async () => {
    const base = request({ max_tokens: 4896, padding: "" });
    const padded = request({ max_tokens: 4896, padding: "x".repeat(32768 - 1024 - Buffer.byteLength(base.init.body)) });
    const t = setup();
    const perCall = 32768 + 4896 * 4;
    const allowed = Math.floor(7_562_784 / perCall);
    for (let index = 0; index < allowed; index++) await t.execute({ ...padded, role: "character" });
    await expect(t.execute({ ...padded, role: "character" })).rejects.toThrow("PAID_BUDGET_EXHAUSTED");
    expect(t.snapshot().reservedCostMicros).toBe(allowed * perCall);
    expect(t.snapshot().reservedCostMicros).toBeLessThanOrEqual(7_562_784);
    expect(t.network).toHaveBeenCalledTimes(allowed);
    expect(allowed).toBeLessThan(156);
    expect(t.durable.at(-1)?.blockedReason).toBe("PAID_BUDGET_EXHAUSTED");
  });

  it("serializes reservations by rejecting overlapping calls", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const t = setup({ persist: async () => pending });
    const first = t.execute(request());
    await expect(t.execute(request())).rejects.toThrow("TRANSPORT_BUSY");
    release(); await first;
    expect(t.network).toHaveBeenCalledTimes(1);
  });
});
