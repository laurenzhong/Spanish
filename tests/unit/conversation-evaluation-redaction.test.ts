// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasProviderPlanning, redactCheckpointText, redactProviderText } from "../../scripts/conversation-evaluation/redaction";
import { coreRoutes, makeOfflineManifest } from "../../scripts/conversation-evaluation/routes";
import { runTrajectory } from "../../scripts/conversation-evaluation/runner";
import { renderReports } from "../../scripts/conversation-evaluation/store";

describe("provider final-text planning redaction", () => {
  it.each(["<analysis>synthetic-private-fixture", "<|reasoning|>synthetic-private-fixture"])("redacts alternate protocol markers", (text) => {
    expect(redactProviderText(text)).not.toContain("synthetic-private-fixture");
  });
  it("keeps clean language and replaces contaminated candidates with only hash evidence", () => {
    expect(redactProviderText("Me alegra hablar contigo.")).toBe("Me alegra hablar contigo.");
    const contaminated = "synthetic fixture </mm:think> Mensaje final.";
    expect(hasProviderPlanning(contaminated)).toBe(true);
    const redacted = redactProviderText(contaminated);
    expect(redacted).toContain(createHash("sha256").update(contaminated).digest("hex"));
    expect(redacted).not.toContain("synthetic fixture");
    expect(redactProviderText(redacted)).toBe(redacted);
  });

  it("sanitizes copies while preserving clean transcript, user data and manifest", () => {
    const value = { manifest: { source: "unchanged" }, traces: [{ output: "<think>synthetic fixture" }],
      sandbox: { messages: [{ role: "character", content: "Hola." }, { role: "user", content: "My literal quote: <think>" }] }, partial: null };
    const redacted = redactCheckpointText(value);
    expect(redacted.traces[0].output).not.toContain("synthetic fixture");
    expect(redacted.manifest).toEqual(value.manifest);
    expect(redacted.sandbox.messages).toEqual(value.sandbox.messages);
    expect(value.traces[0].output).toContain("synthetic fixture");
  });

  it("does not persist or export contaminated candidate bodies", async () => {
    const route = { ...coreRoutes[0], steps: coreRoutes[0].steps.slice(0, 1) };
    const snapshots: unknown[] = [];
    const result = await runTrajectory({ route, manifest: makeOfflineManifest({ runId: "redaction-test", trajectoryId: "r01", route }),
      participants: { character: async () => "synthetic-private-fixture </mm:think> Hola." }, persist: async (state) => { snapshots.push(state); } });
    expect(JSON.stringify(snapshots)).not.toContain("synthetic-private-fixture");
    expect(JSON.stringify(renderReports(result, route))).not.toContain("synthetic-private-fixture");
    expect(result.traces.some((trace) => trace.output?.includes("SHA-256"))).toBe(true);
  });
});
