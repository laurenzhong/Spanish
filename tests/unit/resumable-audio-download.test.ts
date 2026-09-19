import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadResumableAudio } from "@/src/modules/media/storage/resumable-audio-download";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "audio-range-test-")); directories.push(directory);
  const content = Buffer.alloc(96, 23);
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const range = new Headers(init?.headers).get("range")!;
    const [, start, end] = /bytes=(\d+)-(\d+)/u.exec(range)!;
    return new Response(content.subarray(Number(start), Number(end) + 1), { status: 206, headers: {
      "content-range": `bytes ${start}-${end}/96`, "content-type": "audio/mpeg", etag: '"original"',
    } });
  });
  const options = { source: async () => new URL("https://source.test/audio?secret=hidden"), directory, allowedHosts: new Set(["source.test"]), maxBytes: 1000, chunkSize: 32, retryDelayMs: 0, fetcher };
  return { content, options, fetcher, directory };
}
describe("resumable audio acquisition", () => {
  it("retains validated chunks after failure and resumes without downloading them again", async () => {
    const { options, fetcher, content } = await fixture();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (new Headers(init?.headers).get("range") === "bytes=32-63") throw new Error("network secret");
      return original(url, init);
    });
    await expect(downloadResumableAudio(options)).rejects.toThrow("AUDIO_RANGE_NETWORK_FAILED");
    fetcher.mockImplementation(original); fetcher.mockClear();
    expect(await downloadResumableAudio(options)).toEqual(content);
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get("range"))).toEqual(["bytes=0-31", "bytes=32-63", "bytes=64-95"]);
  });
  it("redownloads a corrupt cached chunk", async () => {
    const { options, directory, content, fetcher } = await fixture();
    await downloadResumableAudio(options);
    const [cache] = await readdir(directory);
    await writeFile(resolve(directory, cache, "32.part"), Buffer.alloc(32, 0));
    fetcher.mockClear();
    expect(await downloadResumableAudio(options)).toEqual(content);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects changed validators and does not checkpoint mixed content", async () => {
    const { options, fetcher } = await fixture();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (new Headers(init?.headers).get("if-range")) response.headers.set("etag", '"changed"');
      return response;
    });
    await expect(downloadResumableAudio(options)).rejects.toThrow("AUDIO_SOURCE_CHANGED");
  });
  it("blocks redirects to hosts outside the allowlist", async () => {
    const { options, fetcher } = await fixture();
    fetcher.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://untrusted.test/private" } }));
    await expect(downloadResumableAudio(options)).rejects.toThrow("AUDIO_SOURCE_NOT_ALLOWED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
