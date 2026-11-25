import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";

const videoKey = "video.e2e-native";
const podcastKey = "podcast.e2e-cafe";

function silentAudio(): Buffer {
  const sampleRate = 8_000;
  const pcmBytes = sampleRate * 2 * 3;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

function serveMedia(request: IncomingMessage, response: ServerResponse, data: Buffer, mime: string) {
  const headers = { "accept-ranges": "bytes", "cache-control": "no-store", "content-type": mime };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (!range) {
    response.writeHead(200, { ...headers, "content-length": data.length }).end(data);
    return;
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
  if (start > end) {
    response.writeHead(416, { ...headers, "content-range": `bytes */${data.length}` }).end();
    return;
  }
  response.writeHead(206, {
    ...headers,
    "content-range": `bytes ${start}-${end}/${data.length}`,
    "content-length": end - start + 1,
  }).end(data.subarray(start, end + 1));
}

for (const kind of ["video", "audio"] as const) {
  test(`recovers a failed hosted ${kind} source and reports buffering before native playback`, async ({ page, baseURL }) => {
    const resource = kind === "video" ? await readFile("public/public-home/midnight-sun-kiruna.mp4") : silentAudio();
    const mime = kind === "video" ? "video/mp4" : "audio/wav";
    let resourceAvailable = false;
    let finishResponse!: () => void;
    const pending = new Promise<void>((resolve) => { finishResponse = resolve; });
    const server = createServer(async (request, response) => {
      if (!resourceAvailable) {
        response.writeHead(503, { "cache-control": "no-store" }).end();
        return;
      }
      await pending;
      if (!response.destroyed) serveMedia(request, response, resource, mime);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing media fixture port");
      // WebKit's media process performs its own Range requests. Give it a real
      // loopback origin and leave native loading and decoding intact.
      await page.addInitScript((url) => {
        const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
          ...source,
          set(value: string) {
            source.set!.call(this, value.startsWith("https://media.example.test/") ? url : value);
          },
        });
      }, `http://127.0.0.1:${address.port}/fixture`);
      await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL! }]);
      await page.route("**/api/v1/media/*/progress", (route) => route.fulfill({ json: { data: { progress: { revision: 1 } } } }));
      await page.goto(`/learn/media/${kind === "video" ? videoKey : podcastKey}`, { waitUntil: "domcontentloaded" });
      const status = page.locator(".media-player-status");
      await expect(status).toHaveAttribute("role", "alert");
      await expect(status).toContainText("暂时无法播放");
      resourceAvailable = true;
      await page.getByRole("button", { name: "重试播放" }).click();
      await expect(status).toHaveText("播放器准备中…");
      await page.locator('.plyr__controls button[data-plyr="play"]').click();
      await expect(status).toHaveText("正在缓冲…");
      const player = page.locator(`.media-detail__player ${kind}`);
      expect(await player.evaluate((element: HTMLMediaElement) => element.currentTime)).toBe(0);
      finishResponse();
      await expect(status).toHaveText("正在播放");
      await expect.poll(() => player.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(0.08);
    } finally {
      finishResponse();
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
  });
}
