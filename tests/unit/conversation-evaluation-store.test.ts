// @vitest-environment node
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createCheckpointStore, renderReports } from "../../scripts/conversation-evaluation/store";
import { coreRoutes, makeOfflineManifest } from "../../scripts/conversation-evaluation/routes";
import { runTrajectory } from "../../scripts/conversation-evaluation/runner";

describe("evaluation durable storage", () => {
  it("keeps immutable checkpoints and refuses corrupted newest data instead of replaying an older call", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "conv-eval-store-"));
    const store = createCheckpointStore(root, "run-a", "route-a");
    await store.exclusive(async () => {
      await store.save({ value: 1 }); await store.save({ value: 2 });
      expect(await store.load()).toEqual({ value: 2 });
    });
    const files = (await readdir(store.directory)).filter((name) => name.endsWith(".json")).sort();
    expect(files).toHaveLength(2);
    await writeFile(path.join(store.directory, files.at(-1)!), '{"unfinished":');
    await expect(store.load()).rejects.toThrow("CHECKPOINT_CORRUPT");
  });

  it("prevents concurrent runners for one trajectory and releases the lock on exceptions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "conv-eval-lock-"));
    const store = createCheckpointStore(root, "run-a", "route-a");
    await expect(store.exclusive(async () => {
      await expect(store.exclusive(async () => {})).rejects.toThrow("TRAJECTORY_LOCKED");
      throw new Error("fixture-failure");
    })).rejects.toThrow("fixture-failure");
    await expect(store.exclusive(async () => "restored")).resolves.toBe("restored");
    expect(() => createCheckpointStore(root, "..", "route-a")).toThrow();
  });

  it("recovers only a confirmed dead local process lock, preserving checkpoints and live locks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "conv-eval-recover-"));
    const store = createCheckpointStore(root, "run-a", "route-a");
    await store.exclusive(async () => {
      await store.save({ durable: true });
      await expect(store.recoverAbandonedLock()).rejects.toThrow("TRAJECTORY_LOCKED");
    });
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true });
    const pid = child.pid;
    await new Promise<void>((resolve, reject) => { child.once("exit", () => resolve()); child.once("error", reject); });
    expect(pid).toBeGreaterThan(0);
    const lock = path.join(store.directory, "writer.lock");
    await writeFile(lock, JSON.stringify({ pid, hostname: os.hostname() }));
    await expect(store.exclusive(async () => {})).rejects.toThrow("TRAJECTORY_LOCKED");
    expect(await store.recoverAbandonedLock()).toBe(true);
    expect(await store.recoverAbandonedLock()).toBe(false);
    await store.exclusive(async () => { expect(await store.load()).toEqual({ durable: true }); });
    await writeFile(lock, JSON.stringify({ pid, hostname: "unknown-other-host" }));
    await expect(store.recoverAbandonedLock()).rejects.toThrow("LOCK_OWNER_UNKNOWN");
    expect(JSON.parse(await readFile(lock, "utf8"))).toMatchObject({ hostname: "unknown-other-host" });
  });

  it("renders incomplete tests truthfully and keeps the entire transcript in both readable and replay forms", async () => {
    const route = { ...coreRoutes[0], steps: coreRoutes[0].steps.slice(0, 2) };
    const result = await runTrajectory({ manifest: makeOfflineManifest({ runId: "report-run", trajectoryId: "report-route", route }), route });
    const report = renderReports(result, route);
    expect(report.transcriptMarkdown).toContain("¡Hola! Soy Lucía");
    expect(report.summaryMarkdown).toContain("不代表真实聊天质量通过");
    expect(report.messageCount).toBe(result.sandbox.messages.length);
    expect(report.turnCount).toBe(2);
    const stopped = structuredClone(result); stopped.status = "interrupted";
    expect(renderReports(stopped, route).summaryMarkdown).toContain("interrupted");
    const root = await mkdtemp(path.join(os.tmpdir(), "conv-eval-report-"));
    const store = createCheckpointStore(root, "report-run", "report-route");
    await store.exclusive(() => store.save(result));
    const name = (await readdir(store.directory)).find((n) => n.endsWith(".json"))!;
    const raw = await readFile(path.join(store.directory, name), "utf8");
    expect(raw).toContain("new_contact");
    expect(raw).not.toContain("api_key");
  });
});
