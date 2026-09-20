import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_COOKIE_BYTES = 10 * 1024 * 1024;

export class YoutubeCookiesError extends Error {
  readonly code = "MEDIA_VIDEO_COOKIES_INVALID" as const;
}

function fail(message: string): never {
  throw new YoutubeCookiesError(message);
}

function decodeBase64(value: string): string {
  const compact = value.replace(/\s+/gu, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    fail("MEDIA_VIDEO_COOKIES_BASE64_INVALID");
  }
  const decoded = Buffer.from(compact, "base64");
  if (decoded.length === 0 || decoded.length > MAX_COOKIE_BYTES) fail("MEDIA_VIDEO_COOKIES_SIZE_INVALID");
  return decoded.toString("utf8").replace(/^\uFEFF/u, "");
}

export function validateNetscapeCookies(value: string): void {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_COOKIE_BYTES) fail("MEDIA_VIDEO_COOKIES_SIZE_INVALID");
  const cookieLines = value.split(/\r?\n/u).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_");
  });
  const httpOnlyLines = value.split(/\r?\n/u).filter((line) => line.trim().startsWith("#HttpOnly_"));
  const dataLines = [...cookieLines, ...httpOnlyLines];
  if (dataLines.length === 0) fail("MEDIA_VIDEO_COOKIES_EMPTY");
  for (const rawLine of dataLines) {
    const line = rawLine.trim().startsWith("#HttpOnly_")
      ? rawLine.trim().slice("#HttpOnly_".length)
      : rawLine.trim();
    const fields = line.split("\t");
    if (fields.length !== 7) fail("MEDIA_VIDEO_COOKIES_FORMAT_INVALID");
    const [domain, includeSubdomains, path, secure, expiration, name] = fields;
    if (!domain || !/^(?:true|false)$/iu.test(includeSubdomains ?? "")
      || !path?.startsWith("/") || !/^(?:true|false)$/iu.test(secure ?? "")
      || !/^\d+$/u.test(expiration ?? "") || !name) {
      fail("MEDIA_VIDEO_COOKIES_FORMAT_INVALID");
    }
  }
}

export async function prepareYoutubeCookiesFile(input: Readonly<{
  directory: string;
  sourceFile?: string | null;
  base64?: string | null;
}>): Promise<string | null> {
  const sourceFile = input.sourceFile?.trim() || null;
  const base64 = input.base64?.trim() || null;
  if (sourceFile && base64) fail("MEDIA_VIDEO_COOKIES_INPUT_CONFLICT");
  if (!sourceFile && !base64) return null;
  let value: string;
  if (base64) {
    value = decodeBase64(base64);
  } else {
    let bytes: Buffer;
    try {
      bytes = await readFile(sourceFile!);
    } catch {
      fail("MEDIA_VIDEO_COOKIES_FILE_UNREADABLE");
    }
    if (bytes.length === 0 || bytes.length > MAX_COOKIE_BYTES) fail("MEDIA_VIDEO_COOKIES_SIZE_INVALID");
    value = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  }
  validateNetscapeCookies(value);
  const target = join(input.directory, "youtube-cookies.txt");
  await writeFile(target, value, { encoding: "utf8", mode: 0o600 });
  return target;
}

export function withYoutubeCookies(args: readonly string[], cookieFile: string | null): string[] {
  return cookieFile ? [...args, "--cookies", cookieFile] : [...args];
}
