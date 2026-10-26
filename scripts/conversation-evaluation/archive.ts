import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export type ArchiveInput = Readonly<{
  runId: string;
  trajectoryId: string;
  transcriptMarkdown: string;
  summaryMarkdown: string;
  replay: unknown;
  messageCount: number;
  turnCount: number;
}>;

export type ArchiveResult = Readonly<{
  status: "complete" | "archive_failed" | "backup_failed";
  primaryPath: string;
  backupPath: string;
  error?: string;
}>;

type ArchiveArgs = Readonly<{ primaryRoot: string; backupRoot: string; input: ArchiveInput }>;
type Intent = Readonly<{
  schemaVersion: 1;
  inputDigest: string;
  createdAt: string;
  primaryPath: string;
  backupPath: string;
}>;
type Payloads = Readonly<Record<string, string>>;

const intentName = ".archive-intent.json";
const manifestName = "归档清单.json";

class ArchiveError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new ArchiveError("ARCHIVE_INVALID_INPUT");
  return `${serialized}\n`;
}

function comparePath(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(comparePath(parent), comparePath(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,99}$/iu.test(value)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(value);
}

function validate(args: ArchiveArgs): void {
  const { input } = args;
  if (!path.isAbsolute(args.primaryRoot) || !path.isAbsolute(args.backupRoot)
    || isWithin(args.primaryRoot, args.backupRoot) || isWithin(args.backupRoot, args.primaryRoot)
    || !isIdentifier(input.runId) || !isIdentifier(input.trajectoryId)
    || typeof input.transcriptMarkdown !== "string" || typeof input.summaryMarkdown !== "string"
    || !Number.isSafeInteger(input.messageCount) || input.messageCount < 0
    || !Number.isSafeInteger(input.turnCount) || input.turnCount < 0) {
    throw new ArchiveError("ARCHIVE_INVALID_INPUT");
  }
}

function fsCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function errorCode(error: unknown): string {
  if (error instanceof ArchiveError) return error.code;
  if (fsCode(error) === "ENOSPC") return "ARCHIVE_NO_SPACE";
  if (fsCode(error) === "EACCES" || fsCode(error) === "EPERM") return "ARCHIVE_ACCESS_DENIED";
  return "ARCHIVE_IO_ERROR";
}

/** Refuse symlink/junction traversal, including through a supplied root's ancestors. */
async function ensureDirectory(directory: string): Promise<void> {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (fsCode(error) !== "EEXIST") throw error;
    }
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new ArchiveError("ARCHIVE_UNSAFE_PATH");
    if (!metadata.isDirectory()) throw new ArchiveError("ARCHIVE_NOT_DIRECTORY");
  }
}

async function readRegularFile(file: string): Promise<Buffer | null> {
  try {
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ArchiveError("ARCHIVE_UNSAFE_PATH");
    return await readFile(file);
  } catch (error) {
    if (fsCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** A hard-link publishes a fully flushed temp file atomically without replacing a winner. */
async function publishExclusive(file: string, contents: string): Promise<boolean> {
  const temporary = path.join(path.dirname(file), `.archive-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await link(temporary, file);
    return true;
  } catch (error) {
    if (fsCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    // Only remove the random temp file created by this invocation; never recursive cleanup.
    await unlink(temporary).catch(() => undefined);
  }
}

async function writeImmutable(file: string, contents: string): Promise<void> {
  const expected = Buffer.from(contents, "utf8");
  const prior = await readRegularFile(file);
  if (prior) {
    if (!prior.equals(expected)) throw new ArchiveError("ARCHIVE_COLLISION");
    return;
  }
  await publishExclusive(file, contents);
  const actual = await readRegularFile(file);
  if (!actual?.equals(expected)) throw new ArchiveError("ARCHIVE_COLLISION");
}

async function reserveIntent(file: string, expected: Omit<Intent, "createdAt">): Promise<Intent> {
  const prior = await readRegularFile(file);
  if (!prior) await publishExclusive(file, json({ ...expected, createdAt: new Date().toISOString() }));
  const content = await readRegularFile(file);
  let candidate: unknown;
  try {
    candidate = content ? JSON.parse(content.toString("utf8")) : null;
  } catch {
    throw new ArchiveError("ARCHIVE_COLLISION");
  }
  if (!candidate || typeof candidate !== "object") throw new ArchiveError("ARCHIVE_COLLISION");
  const saved = candidate as Record<string, unknown>;
  if (saved.schemaVersion !== 1 || saved.inputDigest !== expected.inputDigest
    || saved.primaryPath !== expected.primaryPath || saved.backupPath !== expected.backupPath
    || typeof saved.createdAt !== "string" || !Number.isFinite(Date.parse(saved.createdAt))) {
    throw new ArchiveError("ARCHIVE_COLLISION");
  }
  return saved as Intent;
}

async function verifyFiles(directory: string, payloads: Payloads): Promise<void> {
  for (const [name, text] of Object.entries(payloads)) {
    const content = await readRegularFile(path.join(directory, name));
    if (!content || sha256(content) !== sha256(text)) throw new ArchiveError("ARCHIVE_VERIFICATION_FAILED");
  }
}

/**
 * Stores synthetic evaluation artifacts, then a byte-identical desktop backup.
 * The caller supplies already-sanitized replay data and owns generation/cleanup.
 * Errors expose stable codes only. This function never invokes providers or deletes archives.
 */
export async function archiveEvaluation(args: ArchiveArgs): Promise<ArchiveResult> {
  let primaryPath = "";
  let backupPath = "";
  let payloads: Payloads;
  try {
    validate(args);
    primaryPath = path.join(path.resolve(args.primaryRoot), args.input.runId, args.input.trajectoryId);
    backupPath = path.join(path.resolve(args.backupRoot), args.input.runId, args.input.trajectoryId);
    payloads = {
      "聊天记录.md": args.input.transcriptMarkdown,
      "测试问题总结.md": args.input.summaryMarkdown,
      "回放数据.json": json(args.input.replay),
    };
  } catch {
    return { status: "archive_failed", primaryPath, backupPath, error: "ARCHIVE_INVALID_INPUT" };
  }

  let completePayloads: Payloads;
  try {
    await ensureDirectory(primaryPath);
    const inputDigest = sha256(json({ payloads, messageCount: args.input.messageCount, turnCount: args.input.turnCount }));
    const intent = await reserveIntent(path.join(primaryPath, intentName), { schemaVersion: 1, inputDigest, primaryPath, backupPath });
    const manifest = {
      schemaVersion: 1,
      runId: args.input.runId,
      trajectoryId: args.input.trajectoryId,
      createdAt: intent.createdAt,
      // Describes this set's content, not a claim that the other location is available.
      status: "content_complete",
      primaryPath,
      backupPath,
      messageCount: args.input.messageCount,
      turnCount: args.input.turnCount,
      files: Object.fromEntries(Object.entries(payloads).map(([name, text]) => [name, { sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8") }])),
    };
    // Intent first and manifest last make interrupted publication recoverable without overwrites.
    completePayloads = { [intentName]: json(intent), ...payloads, [manifestName]: json(manifest) };
    for (const [name, contents] of Object.entries(completePayloads)) await writeImmutable(path.join(primaryPath, name), contents);
    await verifyFiles(primaryPath, completePayloads);
  } catch (error) {
    return { status: "archive_failed", primaryPath, backupPath, error: errorCode(error) };
  }

  try {
    await ensureDirectory(backupPath);
    for (const [name, contents] of Object.entries(completePayloads)) await writeImmutable(path.join(backupPath, name), contents);
    await verifyFiles(backupPath, completePayloads);
    // Detect a main archive changed during backup rather than claiming a valid pair.
    await verifyFiles(primaryPath, completePayloads);
    return { status: "complete", primaryPath, backupPath };
  } catch (error) {
    return { status: "backup_failed", primaryPath, backupPath, error: errorCode(error) };
  }
}
