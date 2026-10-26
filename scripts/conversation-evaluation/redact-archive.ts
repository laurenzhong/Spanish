import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { z } from "zod";
import { fingerprint, routeSchema, safeId } from "./manifest";
import { redactCheckpointText } from "./redaction";
import { renderReports } from "./store";
import type { EvaluationCheckpoint } from "./runner";
import type { ArchiveInput } from "./archive";

const trajectories = ["r01", "r04", "r05"] as const;
const payloadNames = ["聊天记录.md", "测试问题总结.md", "回放数据.json"] as const;
const archiveNames = [".archive-intent.json", ...payloadNames, "归档清单.json"] as const;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const intentSchema = z.object({ schemaVersion: z.literal(1), inputDigest: digest, createdAt: z.iso.datetime(), primaryPath: z.string(), backupPath: z.string() }).strict();
const archiveSchema = z.object({
  schemaVersion: z.literal(1), runId: safeId, trajectoryId: safeId, createdAt: z.iso.datetime(), status: z.literal("content_complete"),
  primaryPath: z.string(), backupPath: z.string(), messageCount: z.number().int().nonnegative(), turnCount: z.number().int().nonnegative(),
  files: z.record(z.string(), z.object({ sha256: digest, bytes: z.number().int().nonnegative() }).strict()),
}).strict();
const auditSchema = z.object({
  schemaVersion: z.literal(1), runId: safeId,
  events: z.array(z.object({
    version: z.literal("provider-final-text-planning-redaction-v1"), reason: z.literal("no-model-thinking-retention"),
    scope: z.literal("nonvisible candidate redaction"), at: z.iso.datetime(),
    rendererCorrection: z.literal("report-review-count-accuracy;original-execution-manifests-preserved"),
    files: z.array(z.object({ location: z.enum(["primary", "backup"]), path: z.string(), originalSha256: digest, newSha256: digest }).strict()),
  }).strict()),
}).strict();
type Replacement = { file: string; location: "primary" | "backup"; relative: string; original: string | null; contents: string };

function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function noLinks(target: string): Promise<void> {
  const parent = path.dirname(target);
  if (parent !== target) await noLinks(parent);
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error("REDACTION_UNSAFE_PATH");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function readRegular(file: string): Promise<string> {
  await noLinks(file);
  const info = await lstat(file);
  if (!info.isFile() || info.nlink !== 1) throw new Error("REDACTION_UNSAFE_FILE");
  return readFile(file, "utf8");
}
async function optionalRegular(file: string): Promise<string | null> {
  try { return await readRegular(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function sanitize(state: EvaluationCheckpoint, runId: string, trajectoryId: string): EvaluationCheckpoint {
  if (state.manifest?.runId !== runId || state.manifest.trajectoryId !== trajectoryId || !Array.isArray(state.traces)
    || !Array.isArray(state.sandbox?.messages) || !Array.isArray(state.turns)) throw new Error("REDACTION_CHECKPOINT_SCOPE");
  const result = redactCheckpointText(state);
  // This remediation is authorized only for non-visible candidates, never delivered dialogue.
  if (fingerprint(state.sandbox) !== fingerprint(result.sandbox) || fingerprint(state.partial) !== fingerprint(result.partial)) throw new Error("REDACTION_VISIBLE_TEXT_REQUIRES_REVIEW");
  return result;
}
async function replaceAtomic(root: string, replacement: Replacement): Promise<void> {
  if (!within(root, replacement.file)) throw new Error("REDACTION_UNSAFE_PATH");
  await noLinks(replacement.file);
  if (await optionalRegular(replacement.file) !== replacement.original) throw new Error("REDACTION_SOURCE_CHANGED");
  const temporary = path.join(path.dirname(replacement.file), `.redaction-${randomUUID()}.tmp`);
  if (!within(root, temporary)) throw new Error("REDACTION_UNSAFE_PATH");
  const handle = await open(temporary, "wx", 0o600);
  try {
    // Only new sanitized bytes are ever placed in a temporary file.
    await handle.writeFile(replacement.contents, "utf8"); await handle.sync();
  } finally { await handle.close(); }
  try {
    await noLinks(replacement.file);
    if (await optionalRegular(replacement.file) !== replacement.original) throw new Error("REDACTION_SOURCE_CHANGED");
    for (let attempt = 0; ; attempt++) {
      if (process.platform === "win32") await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      try { await rename(temporary, replacement.file); break; }
      catch (error) {
        // Windows indexing/AV may briefly hold a newly read destination; never unlink it.
        if (attempt >= 7 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await noLinks(replacement.file);
        if (await optionalRegular(replacement.file) !== replacement.original) throw new Error("REDACTION_SOURCE_CHANGED");
      }
    }
    if (await readRegular(replacement.file) !== replacement.contents) throw new Error("REDACTION_WRITE_VERIFICATION_FAILED");
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** Explicit offline exception to archive immutability; caller must authorize the exact ended batch. */
export async function redactArchivedBaseline(args: { primaryRoot: string; backupRoot: string; runId: string }) {
  const runId = safeId.parse(args.runId);
  if (!path.isAbsolute(args.primaryRoot) || !path.isAbsolute(args.backupRoot)) throw new Error("REDACTION_ABSOLUTE_ROOT_REQUIRED");
  const roots = { primary: path.resolve(args.primaryRoot), backup: path.resolve(args.backupRoot) };
  if (within(roots.primary, roots.backup) || within(roots.backup, roots.primary)) throw new Error("REDACTION_ROOTS_OVERLAP");
  for (const root of Object.values(roots)) {
    await noLinks(root);
    if (!(await lstat(path.join(root, runId))).isDirectory()) throw new Error("REDACTION_RUN_MISSING");
    await noLinks(path.join(root, runId));
  }
  const locks: { file: string; handle: Awaited<ReturnType<typeof open>> }[] = [];
  try {
    // Use the same writer guard as execution/export. Existing locks fail closed; no lock recovery here.
    for (const scope of ["batch-real", "paid-ledger", ...trajectories]) {
      const directory = path.join(roots.primary, ".checkpoints", runId, scope);
      await noLinks(directory);
      if (!(await lstat(directory)).isDirectory()) throw new Error("REDACTION_CHECKPOINT_DIRECTORY_MISSING");
      if (await optionalRegular(path.join(directory, "recovery.lock")) !== null) throw new Error("REDACTION_WRITER_LOCKED");
      const file = path.join(directory, "writer.lock"); await noLinks(file);
      let handle;
      try { handle = await open(file, "wx", 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("REDACTION_WRITER_LOCKED"); throw error; }
      locks.push({ file, handle });
      await handle.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname(), purpose: "nonvisible-candidate-redaction" }));
    }
    const changes: Replacement[] = [];
    const add = async (location: "primary" | "backup", relative: string, contents: string) => {
      const file = path.resolve(roots[location], relative);
      if (!within(roots[location], file)) throw new Error("REDACTION_UNSAFE_PATH");
      const original = await readRegular(file);
      if (original !== contents) changes.push({ file, location, relative, original, contents });
    };
    const latest = new Map<string, EvaluationCheckpoint>();
    const originalLatestHashes = new Map<string, string>();
    for (const trajectoryId of trajectories) {
      const relativeDirectory = path.join(".checkpoints", runId, trajectoryId);
      const directory = path.join(roots.primary, relativeDirectory);
      const entries = (await readdir(directory)).filter((name) => /^checkpoint-\d{8}\.json$/u.test(name)).sort();
      if (!entries.length) throw new Error("REDACTION_CHECKPOINT_MISSING");
      for (const name of entries) {
        const raw = await readRegular(path.join(directory, name));
        const envelope = JSON.parse(raw) as { hash: string; state: EvaluationCheckpoint };
        if (Object.keys(envelope).sort().join(",") !== "hash,state" || fingerprint(envelope.state) !== envelope.hash) throw new Error("REDACTION_CHECKPOINT_CORRUPT");
        const state = sanitize(envelope.state, runId, trajectoryId);
        if (fingerprint(state) !== envelope.hash) await add("primary", path.join(relativeDirectory, name), json({ hash: fingerprint(state), state }));
        latest.set(trajectoryId, state);
        originalLatestHashes.set(trajectoryId, envelope.hash);
      }
      const terminal = latest.get(trajectoryId)!;
      if (["running", "paused"].includes(terminal.status) || terminal.activeStep !== null || terminal.pending !== null) throw new Error("REDACTION_BATCH_NOT_ENDED");
    }

    for (const trajectoryId of [...trajectories, "batch-summary"]) {
      const relativeDirectory = path.join(runId, trajectoryId);
      const primaryPath = path.join(roots.primary, relativeDirectory), backupPath = path.join(roots.backup, relativeDirectory);
      const previous: Record<string, string> = {};
      for (const name of archiveNames) {
        const main = await readRegular(path.join(primaryPath, name));
        if (await readRegular(path.join(backupPath, name)) !== main) throw new Error("REDACTION_BACKUP_MISMATCH");
        previous[name] = main;
      }
      const intent = intentSchema.parse(JSON.parse(previous[".archive-intent.json"]));
      const manifest = archiveSchema.parse(JSON.parse(previous["归档清单.json"]));
      if (intent.primaryPath !== primaryPath || intent.backupPath !== backupPath || manifest.primaryPath !== primaryPath || manifest.backupPath !== backupPath
        || manifest.runId !== runId || manifest.trajectoryId !== trajectoryId || manifest.createdAt !== intent.createdAt) throw new Error("REDACTION_ARCHIVE_SCOPE");
      const oldPayloads = Object.fromEntries(payloadNames.map((name) => [name, previous[name]]));
      for (const name of payloadNames) {
        if (manifest.files[name]?.sha256 !== hash(previous[name]) || manifest.files[name]?.bytes !== Buffer.byteLength(previous[name])) throw new Error("REDACTION_ARCHIVE_CORRUPT");
      }
      if (Object.keys(manifest.files).sort().join(",") !== [...payloadNames].sort().join(",")) throw new Error("REDACTION_ARCHIVE_CORRUPT");
      if (intent.inputDigest !== hash(json({ payloads: oldPayloads, messageCount: manifest.messageCount, turnCount: manifest.turnCount }))) throw new Error("REDACTION_INTENT_CORRUPT");
      let input: ArchiveInput;
      if (trajectoryId === "batch-summary") {
        const replay = JSON.parse(previous["回放数据.json"]) as { results: { trajectoryId: string; checkpointHash: string }[] };
        if (!Array.isArray(replay.results) || replay.results.length !== 3 || new Set(replay.results.map((result) => result.trajectoryId)).size !== 3) throw new Error("REDACTION_BATCH_INDEX_INVALID");
        for (const result of replay.results) {
          const state = latest.get(result.trajectoryId);
          if (!state) throw new Error("REDACTION_BATCH_INDEX_INVALID");
          if (result.checkpointHash !== originalLatestHashes.get(result.trajectoryId)) throw new Error("REDACTION_BATCH_INDEX_INVALID");
          result.checkpointHash = fingerprint(state);
        }
        input = { runId, trajectoryId, transcriptMarkdown: previous["聊天记录.md"], summaryMarkdown: previous["测试问题总结.md"],
          replay, messageCount: manifest.messageCount, turnCount: manifest.turnCount };
      } else {
        const replay = JSON.parse(previous["回放数据.json"]) as { route: unknown; checkpoint: EvaluationCheckpoint; billing?: unknown };
        const state = sanitize(replay.checkpoint, runId, trajectoryId);
        if (fingerprint(state) !== fingerprint(latest.get(trajectoryId))) throw new Error("REDACTION_ARCHIVE_CHECKPOINT_MISMATCH");
        input = renderReports(state, routeSchema.parse(replay.route), replay.billing);
        if (input.transcriptMarkdown !== previous["聊天记录.md"] || input.messageCount !== manifest.messageCount || input.turnCount !== manifest.turnCount) throw new Error("REDACTION_VISIBLE_TEXT_REQUIRES_REVIEW");
      }
      // Keep property order and newline identical to archiveEvaluation's payload/digest format.
      const payloads = { "聊天记录.md": input.transcriptMarkdown, "测试问题总结.md": input.summaryMarkdown, "回放数据.json": json(input.replay) };
      const updatedIntent = { ...JSON.parse(previous[".archive-intent.json"]), inputDigest: hash(json({ payloads, messageCount: input.messageCount, turnCount: input.turnCount })) };
      const updatedManifest = { ...JSON.parse(previous["归档清单.json"]), files: Object.fromEntries(Object.entries(payloads).map(([name, contents]) => [name, { sha256: hash(contents), bytes: Buffer.byteLength(contents) }])) };
      const desired = { ".archive-intent.json": json(updatedIntent), ...payloads, "归档清单.json": json(updatedManifest) };
      for (const [name, contents] of Object.entries(desired)) for (const location of ["primary", "backup"] as const) await add(location, path.join(relativeDirectory, name), contents);
    }
    const auditRelative = path.join(runId, "redaction-audit.json");
    const previousAudit = await optionalRegular(path.join(roots.primary, auditRelative));
    if (await optionalRegular(path.join(roots.backup, auditRelative)) !== previousAudit) throw new Error("REDACTION_AUDIT_MISMATCH");
    const audit = previousAudit === null ? { schemaVersion: 1 as const, runId, events: [] as z.infer<typeof auditSchema>["events"] } : auditSchema.parse(JSON.parse(previousAudit));
    if (audit.runId !== runId) throw new Error("REDACTION_AUDIT_SCOPE");
    for (const event of audit.events) for (const file of event.files) {
      const target = path.resolve(roots[file.location], file.path);
      if (path.isAbsolute(file.path) || !within(roots[file.location], target)
        || !(within(path.join(roots[file.location], runId), target) || within(path.join(roots[file.location], ".checkpoints", runId), target))) throw new Error("REDACTION_AUDIT_SCOPE");
    }
    if (!changes.length) return { status: "unchanged" as const, modifiedFiles: 0, auditPath: previousAudit === null ? null : path.join(roots.primary, auditRelative) };
    audit.events.push({ version: "provider-final-text-planning-redaction-v1", reason: "no-model-thinking-retention", scope: "nonvisible candidate redaction", at: new Date().toISOString(),
      rendererCorrection: "report-review-count-accuracy;original-execution-manifests-preserved",
      files: changes.map((change) => ({ location: change.location, path: change.relative, originalSha256: hash(change.original!), newSha256: hash(change.contents) })) });
    const auditBytes = json(audit);
    // Preserve only old hashes before replacements, never copies of old private text.
    for (const location of ["primary", "backup"] as const) await replaceAtomic(roots[location], { file: path.join(roots[location], auditRelative), location, relative: auditRelative, original: previousAudit, contents: auditBytes });
    for (const change of changes) await replaceAtomic(roots[change.location], change);
    return { status: "redacted" as const, modifiedFiles: changes.length, auditPath: path.join(roots.primary, auditRelative) };
  } finally {
    for (const lock of locks.reverse()) { await lock.handle.close(); await unlink(lock.file); }
  }
}
