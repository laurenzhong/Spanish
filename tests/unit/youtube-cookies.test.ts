import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  prepareYoutubeCookiesFile,
  validateNetscapeCookies,
  withYoutubeCookies,
} from "@/src/modules/content-acquisition/media/youtube-cookies";

const validCookies = [
  "# Netscape HTTP Cookie File",
  ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tauthorized-value",
  "#HttpOnly_.google.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tprivate-value",
].join("\n");

describe("YouTube authorized cookies", () => {
  it("keeps the default download arguments unchanged without cookies", () => {
    expect(withYoutubeCookies(["--format", "best"], null)).toEqual(["--format", "best"]);
  });

  it("validates Netscape cookies and writes a temporary copy from base64", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sueno-cookie-test-"));
    try {
      const file = await prepareYoutubeCookiesFile({
        directory,
        base64: Buffer.from(validCookies, "utf8").toString("base64"),
      });
      expect(file).toBe(join(directory, "youtube-cookies.txt"));
      expect(await readFile(file!, "utf8")).toBe(validCookies);
      expect(withYoutubeCookies(["--format", "best"], file)).toEqual(["--format", "best", "--cookies", file]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("copies a local cookie file and rejects invalid or conflicting inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sueno-cookie-test-"));
    try {
      const source = join(directory, "source.txt");
      await writeFile(source, validCookies, "utf8");
      const copied = await prepareYoutubeCookiesFile({ directory, sourceFile: source });
      expect(await readFile(copied!, "utf8")).toBe(validCookies);
      await expect(prepareYoutubeCookiesFile({ directory, sourceFile: source, base64: "YQ==" })).rejects.toThrow("MEDIA_VIDEO_COOKIES_INPUT_CONFLICT");
      await expect(prepareYoutubeCookiesFile({ directory, base64: Buffer.from("not-a-cookie-file", "utf8").toString("base64") })).rejects.toThrow("MEDIA_VIDEO_COOKIES_FORMAT_INVALID");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed Netscape rows without exposing cookie content", () => {
    expect(() => validateNetscapeCookies(".youtube.com\tTRUE\t/\tTRUE\t123\tname")).toThrow("MEDIA_VIDEO_COOKIES_FORMAT_INVALID");
    expect(() => validateNetscapeCookies("# comment")).toThrow("MEDIA_VIDEO_COOKIES_EMPTY");
  });
});
