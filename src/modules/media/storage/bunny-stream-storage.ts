import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { MediaAssetStorage } from "./media-asset-storage";

type BunnyVideo = Readonly<{ guid: string; encodeProgress?: number; availableResolutions?: string; status?: number; storageSize?: number }>;
type BunnyFetchResult = Readonly<{ id?: string; success?: boolean; message?: string }>;

const API_BASE = "https://video.bunnycdn.com";

function required(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function responseMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

async function readJson(response: Response): Promise<BunnyVideo> {
  const body = (await response.text()).replace(/^\uFEFF/u, "").trim();
  if (!response.ok) throw new Error(`bunny-stream-api-${response.status}: ${responseMessage(body)}`);
  try {
    return JSON.parse(body) as BunnyVideo;
  } catch {
    throw new Error(`bunny-stream-invalid-response: ${body.slice(0, 300)}`);
  }
}

async function readFetchResult(response: Response): Promise<BunnyFetchResult> {
  const body = (await response.text()).replace(/^\uFEFF/u, "").trim();
  if (!response.ok) throw new Error(`bunny-stream-fetch-${response.status}: ${responseMessage(body)}`);
  try { return JSON.parse(body) as BunnyFetchResult; }
  catch { throw new Error(`bunny-stream-invalid-fetch-response: ${body.slice(0, 300)}`); }
}

function curlFallback(url: string, init: RequestInit | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const contentType = headers.get("content-type") ?? "application/octet-stream";
    const body = init?.body;
    let bodyPath: string | null = null;
    let directory: string | null = null;
    const run = async () => {
      if (body !== undefined && body !== null) {
        directory = await mkdtemp(join(tmpdir(), "sueño-bunny-"));
        bodyPath = join(directory, "body.bin");
        await writeFile(bodyPath, body instanceof Uint8Array || Buffer.isBuffer(body) ? body : String(body));
      }
      const script = [
        "$method=$env:BUNNY_REQUEST_METHOD", "$url=$env:BUNNY_REQUEST_URL", "$path=$env:BUNNY_REQUEST_PATH", "$type=$env:BUNNY_REQUEST_TYPE",
        "$headers=@{AccessKey=$env:BUNNY_STREAM_API_KEY}",
        "if ($method -eq 'GET') { $r=Invoke-WebRequest -Uri $url -Headers $headers -TimeoutSec 120; [Console]::Out.Write([string]$r.Content) }",
        "elseif ($method -eq 'POST') { $r=Invoke-WebRequest -Uri $url -Method Post -Headers $headers -ContentType $type -Body ([IO.File]::ReadAllText($path)) -TimeoutSec 120; [Console]::Out.Write([string]$r.Content) }",
        "elseif ($method -eq 'PUT') { $request=[Net.HttpWebRequest]::Create($url); $request.Method='PUT'; $request.Headers.Add('AccessKey',$env:BUNNY_STREAM_API_KEY); $request.ContentType=$type; $request.SendChunked=$false; $request.AllowWriteStreamBuffering=$false; $file=[IO.File]::OpenRead($path); $request.ContentLength=$file.Length; $stream=$request.GetRequestStream(); $file.CopyTo($stream); $stream.Close(); $file.Close(); $response=$request.GetResponse(); $response.Close() }",
        "else { $r=Invoke-WebRequest -Uri $url -Method $method -Headers $headers -TimeoutSec 120 }",
        "if ($method -ne 'GET' -and $method -ne 'POST' -and $method -ne 'PUT') { Write-Output $r.Content }",
      ].join("\n");
      const scriptPath = join(directory ?? await mkdtemp(join(tmpdir(), "sueño-bunny-")), "request.ps1");
      if (!directory) directory = scriptPath.slice(0, scriptPath.lastIndexOf("\\"));
      await writeFile(scriptPath, script, "utf8");
      if (process.env.BUNNY_STREAM_DEBUG === "1") await writeFile(join(process.cwd(), ".tmp-runtime", "bunny-debug.ps1"), script, "utf8").catch(() => undefined);
      const child = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", scriptPath], {
        env: { ...process.env, BUNNY_REQUEST_METHOD: method, BUNNY_REQUEST_URL: url, BUNNY_REQUEST_PATH: bodyPath ?? "", BUNNY_REQUEST_TYPE: contentType },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
      child.once("error", reject);
      child.once("close", async (code) => {
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        if (code !== 0) {
          reject(new Error(`bunny-stream-curl-${code ?? "unknown"}: ${Buffer.concat(errors).toString("utf8").slice(0, 300)}`));
          return;
        }
        resolve(new Response(Buffer.concat(chunks), { status: 200 }));
      });
    };
    run().catch(reject);
  });
}

async function bunnyFetch(url: string, init: RequestInit): Promise<Response> {
  if (init.method === "PUT" && process.env.BUNNY_STREAM_POWERSHELL_UPLOAD === "1") {
    return curlFallback(url, init);
  }
  try {
    return await fetch(url, init);
  } catch (error) {
    if (process.env.BUNNY_STREAM_CURL_FALLBACK === "0") throw error;
    return curlFallback(url, init);
  }
}

function videoTitle(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 3 ? `${parts[parts.length - 3]} v${parts[parts.length - 2]}` : path.slice(0, 200);
}

export function createBunnyStreamMediaAssetStorage(): MediaAssetStorage | null {
  const libraryId = required("BUNNY_STREAM_LIBRARY_ID");
  const apiKey = required("BUNNY_STREAM_API_KEY");
  const pullZone = required("BUNNY_STREAM_PULL_ZONE_HOSTNAME");
  if (!libraryId || !apiKey || !pullZone) return null;
  const resolution = Number(process.env.MEDIA_VIDEO_MAX_HEIGHT ?? 720);
  if (!Number.isInteger(resolution) || resolution < 144 || resolution > 1_080) throw new Error("bunny-stream-resolution-invalid");
  const configuredLibraryId = libraryId;
  const headers = { AccessKey: apiKey };
  const ids = new Map<string, string>();

  async function getVideo(guid: string): Promise<BunnyVideo> {
    const response = await bunnyFetch(`${API_BASE}/library/${encodeURIComponent(configuredLibraryId)}/videos/${encodeURIComponent(guid)}`, { headers });
    return readJson(response);
  }

  async function waitForEncoding(guid: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.BUNNY_STREAM_ENCODING_TIMEOUT_MS ?? 15 * 60_000);
    while (Date.now() < deadline) {
      const video = await getVideo(guid);
      if (video.status === 5 || video.status === 6) throw new Error("bunny-stream-processing-failed");
      if ((video.status === 4 && (video.storageSize ?? 0) > 0) || (video.status === undefined && (video.encodeProgress ?? 0) >= 100)) return;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error("bunny-stream-encoding-timeout");
  }

  return {
    async putAudio() {
      throw new Error("bunny-stream-audio-unsupported");
    },
    async putVideo(path, body, contentType) {
      if (contentType !== "video/mp4") throw new Error("bunny-stream-mime-unsupported");
      const created = await bunnyFetch(`${API_BASE}/library/${encodeURIComponent(configuredLibraryId)}/videos`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: videoTitle(path) }),
      });
      const video = await readJson(created);
      if (!video.guid) throw new Error("bunny-stream-guid-missing");
      const uploaded = await bunnyFetch(`${API_BASE}/library/${encodeURIComponent(configuredLibraryId)}/videos/${encodeURIComponent(video.guid)}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/octet-stream" },
        body: Buffer.from(body),
      });
      if (!uploaded.ok) throw new Error(`bunny-stream-upload-${uploaded.status}: ${responseMessage(await uploaded.text())}`);
      ids.set(path, video.guid);
      await waitForEncoding(video.guid);
      return { url: `https://${pullZone}/${encodeURIComponent(video.guid)}/play_${resolution}p.mp4` };
    },
    async putVideoFromUrl(path, sourceUrl) {
      const created = await bunnyFetch(`${API_BASE}/library/${encodeURIComponent(configuredLibraryId)}/videos/fetch`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, title: videoTitle(path) }),
      });
      const fetchResult = await readFetchResult(created);
      if (!fetchResult.id) throw new Error("bunny-stream-fetch-id-missing");
      ids.set(path, fetchResult.id);
      await waitForEncoding(fetchResult.id);
      return { url: `https://${pullZone}/${encodeURIComponent(fetchResult.id)}/play_${resolution}p.mp4` };
    },
    async remove(path) {
      const guid = ids.get(path);
      if (!guid) return;
        const response = await bunnyFetch(`${API_BASE}/library/${encodeURIComponent(configuredLibraryId)}/videos/${encodeURIComponent(guid)}`, { method: "DELETE", headers });
      if (!response.ok) throw new Error(`bunny-stream-delete-${response.status}`);
      ids.delete(path);
    },
  };
}
