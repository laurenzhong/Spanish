// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveEvaluation, type ArchiveInput } from "../../scripts/conversation-evaluation/archive";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

let sandbox: string;
let primaryRoot: string;
let backupRoot: string;
const files = ["聊天记录.md", "测试问题总结.md", "回放数据.json", "归档清单.json"];

function input(overrides: Partial<ArchiveInput> = {}): ArchiveInput {
  return {
    runId: "offline-20261025",
    trajectoryId: "r01-user-a",
    transcriptMarkdown: "# 合成聊天\n\nLucía: Hola.\n用户: Hola.\n",
    summaryMarkdown: "# 测试问题总结\n\n仅离线执行器验证，不证明自然度。\n",
    replay: { mode: "fake", messages: [{ role: "character", text: "Hola." }, { role: "user", text: "Hola." }], outcome: "incomplete" },
    messageCount: 2,
    turnCount: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockImplementation(actual.open);
  sandbox = await mkdtemp(path.join(os.tmpdir(), "sueno-eval-archive-"));
  primaryRoot = path.join(sandbox, "workspace", "archives");
  backupRoot = path.join(sandbox, "desktop", "Lucia聊天测试");
});

afterEach(async () => {
  const resolved = path.resolve(sandbox);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("sueno-eval-archive-")) {
    throw new Error("Unsafe test cleanup target");
  }
  await rm(resolved, { recursive: true, force: true });
});

describe("conversation evaluation dual archive", () => {
  it("preserves all messages beyond context limits and verifies byte-identical files in both archives", async () => {
    const lines = Array.from({ length: 130 }, (_, index) => `${index + 1}. usuario: ${"detalle ".repeat(25)}${index}`);
    const transcriptMarkdown = `${lines.join("\n")}\n`;
    const result = await archiveEvaluation({ primaryRoot, backupRoot, input: input({ transcriptMarkdown, messageCount: 130, turnCount: 65 }) });
    expect(result.status).toBe("complete");
    expect(await readFile(path.join(result.primaryPath, "聊天记录.md"), "utf8")).toBe(transcriptMarkdown);
    const manifest = JSON.parse(await readFile(path.join(result.primaryPath, "归档清单.json"), "utf8"));
    expect(manifest).toMatchObject({ schemaVersion: 1, messageCount: 130, turnCount: 65, primaryPath: result.primaryPath, backupPath: result.backupPath });
    for (const name of files) {
      const main = await readFile(path.join(result.primaryPath, name));
      expect(await readFile(path.join(result.backupPath, name))).toEqual(main);
      if (name !== "归档清单.json") {
        expect(manifest.files[name]).toEqual({ sha256: createHash("sha256").update(main).digest("hex"), bytes: main.length });
      }
    }
  });

  it("retries identical input without changing its timestamp or existing report bytes", async () => {
    const args = { primaryRoot, backupRoot, input: input() };
    const first = await archiveEvaluation(args);
    const before = await readFile(path.join(first.primaryPath, "归档清单.json"), "utf8");
    const second = await archiveEvaluation(args);
    expect(second).toEqual(first);
    expect(await readFile(path.join(first.primaryPath, "归档清单.json"), "utf8")).toBe(before);
    expect((await readdir(first.primaryPath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a changed result under the same IDs without touching the original archive", async () => {
    const first = await archiveEvaluation({ primaryRoot, backupRoot, input: input() });
    const before = await readFile(path.join(first.primaryPath, "回放数据.json"), "utf8");
    const collision = await archiveEvaluation({ primaryRoot, backupRoot, input: input({ replay: { outcome: "different" } }) });
    expect(collision).toMatchObject({ status: "archive_failed", error: "ARCHIVE_COLLISION" });
    expect(await readFile(path.join(first.primaryPath, "回放数据.json"), "utf8")).toBe(before);
    expect(await readFile(path.join(first.backupPath, "回放数据.json"), "utf8")).toBe(before);
  });

  it("keeps the authoritative archive when the desktop is unavailable and retries only the export", async () => {
    await mkdir(path.dirname(backupRoot), { recursive: true });
    await writeFile(backupRoot, "blocked desktop root");
    const args = { primaryRoot, backupRoot, input: input() };
    const failed = await archiveEvaluation(args);
    expect(failed).toMatchObject({ status: "backup_failed", error: "ARCHIVE_NOT_DIRECTORY" });
    const before = await readFile(path.join(failed.primaryPath, "聊天记录.md"), "utf8");
    await unlink(backupRoot);
    const retry = await archiveEvaluation(args);
    expect(retry.status).toBe("complete");
    expect(await readFile(path.join(retry.backupPath, "聊天记录.md"), "utf8")).toBe(before);
  });

  it("repairs a partial identical export without overwriting complete files", async () => {
    const args = { primaryRoot, backupRoot, input: input() };
    const first = await archiveEvaluation(args);
    const manifest = await readFile(path.join(first.primaryPath, "归档清单.json"), "utf8");
    await unlink(path.join(first.primaryPath, "测试问题总结.md"));
    await unlink(path.join(first.primaryPath, "归档清单.json"));
    await unlink(path.join(first.backupPath, "聊天记录.md"));
    const retry = await archiveEvaluation(args);
    expect(retry.status).toBe("complete");
    expect(await readFile(path.join(retry.primaryPath, "归档清单.json"), "utf8")).toBe(manifest);
    expect(await readFile(path.join(retry.backupPath, "聊天记录.md"), "utf8")).toBe(input().transcriptMarkdown);
  });

  it("does not overwrite corrupted backup data and retains a usable main archive", async () => {
    const args = { primaryRoot, backupRoot, input: input() };
    const first = await archiveEvaluation(args);
    await writeFile(path.join(first.backupPath, "聊天记录.md"), "foreign data");
    const retry = await archiveEvaluation(args);
    expect(retry).toMatchObject({ status: "backup_failed", error: "ARCHIVE_COLLISION" });
    expect(await readFile(path.join(first.backupPath, "聊天记录.md"), "utf8")).toBe("foreign data");
    expect(await readFile(path.join(first.primaryPath, "聊天记录.md"), "utf8")).toBe(input().transcriptMarkdown);
  });

  it("safely resolves simultaneous identical exports", async () => {
    const args = { primaryRoot, backupRoot, input: input() };
    const results = await Promise.all([archiveEvaluation(args), archiveEvaluation(args)]);
    expect(results.map((result) => result.status)).toEqual(["complete", "complete"]);
    expect(await readFile(path.join(results[0].primaryPath, "归档清单.json"), "utf8"))
      .toBe(await readFile(path.join(results[0].backupPath, "归档清单.json"), "utf8"));
  });

  it("refuses a second concurrent result without mixing payloads", async () => {
    const variants = [input(), input({ transcriptMarkdown: "# Different result\n" })];
    const results = await Promise.all(variants.map((value) => archiveEvaluation({ primaryRoot, backupRoot, input: value })));
    expect(results.map((result) => result.status).sort()).toEqual(["archive_failed", "complete"]);
    const winningIndex = results.findIndex((result) => result.status === "complete");
    expect(await readFile(path.join(results[winningIndex].primaryPath, "聊天记录.md"), "utf8")).toBe(variants[winningIndex].transcriptMarkdown);
    expect(await readFile(path.join(results[winningIndex].backupPath, "聊天记录.md"), "utf8")).toBe(variants[winningIndex].transcriptMarkdown);
  });

  it("reports disk-full backup failure without exposing error text or losing the main archive", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementation(async (...args) => {
      if (String(args[0]).startsWith(backupRoot)) throw Object.assign(new Error("private content must not escape"), { code: "ENOSPC" });
      return actual.open(...args);
    });
    const args = { primaryRoot, backupRoot, input: input() };
    const failed = await archiveEvaluation(args);
    expect(failed).toMatchObject({ status: "backup_failed", error: "ARCHIVE_NO_SPACE" });
    expect(JSON.stringify(failed)).not.toContain("private content");
    expect(await readFile(path.join(failed.primaryPath, "聊天记录.md"), "utf8")).toBe(args.input.transcriptMarkdown);
    vi.mocked(open).mockImplementation(actual.open);
    expect((await archiveEvaluation(args)).status).toBe("complete");
  });

  it("rejects a junction destination instead of writing into another directory", async () => {
    const elsewhere = path.join(sandbox, "elsewhere");
    await mkdir(elsewhere);
    await mkdir(path.dirname(primaryRoot), { recursive: true });
    await symlink(elsewhere, primaryRoot, process.platform === "win32" ? "junction" : "dir");
    const result = await archiveEvaluation({ primaryRoot, backupRoot, input: input() });
    expect(result).toMatchObject({ status: "archive_failed", error: "ARCHIVE_UNSAFE_PATH" });
    expect(await readdir(elsewhere)).toEqual([]);
    await unlink(primaryRoot);
  });

  it.each(["../escape", "..", "a/b", "a\\b", "C:escape", "NUL", "con", "trailing.", ""])('rejects invalid IDs: "%s"', async (runId) => {
    const result = await archiveEvaluation({ primaryRoot, backupRoot, input: input({ runId }) });
    expect(result).toMatchObject({ status: "archive_failed", error: "ARCHIVE_INVALID_INPUT" });
    expect(await readdir(sandbox)).toEqual([]);
  });

  it.each(["same", "nested", "parent", "relative"])("rejects unsafe root relationship: %s", async (kind) => {
    const root = kind === "same" ? primaryRoot : kind === "nested" ? path.join(primaryRoot, "backup") : kind === "parent" ? path.dirname(primaryRoot) : "relative-backup";
    const result = await archiveEvaluation({ primaryRoot, backupRoot: root, input: input() });
    expect(result).toMatchObject({ status: "archive_failed", error: "ARCHIVE_INVALID_INPUT" });
    expect(await readdir(sandbox)).toEqual([]);
  });

  it("refuses unserializable replay and invalid counts before creating output", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const overrides of [{ replay: circular }, { messageCount: -1 }, { turnCount: 1.5 }]) {
      expect(await archiveEvaluation({ primaryRoot, backupRoot, input: input(overrides) }))
        .toMatchObject({ status: "archive_failed", error: "ARCHIVE_INVALID_INPUT" });
    }
    expect(await readdir(sandbox)).toEqual([]);
  });
});
