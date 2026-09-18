import { ContentSourceAdapterError } from "../content-source-adapter";

export type BoundedTextResponse = Readonly<{
  text: string;
  url: string;
  status: number;
  headers: Headers;
}>;

function safeUrl(input: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ContentSourceAdapterError("Source URL is invalid.", false);
  }
  if (url.protocol !== "https:") {
    throw new ContentSourceAdapterError("Source URL must use HTTPS.", false);
  }
  if (url.username || url.password) {
    throw new ContentSourceAdapterError("Source URL cannot contain credentials.", false);
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new ContentSourceAdapterError("Source host is not in the allowlist.", false);
  }
  return url;
}

function responseCharset(contentType: string, body: Uint8Array): string {
  const headerCharset = /charset\s*=\s*["']?([^;\s"']+)/iu.exec(contentType)?.[1];
  if (headerCharset) return headerCharset.toLowerCase();
  const prefix = new TextDecoder("ascii").decode(body.subarray(0, Math.min(body.length, 200)));
  return /<\?xml[^>]+encoding\s*=\s*["']([^"']+)/iu.exec(prefix)?.[1]?.toLowerCase() ?? "utf-8";
}

async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ContentSourceAdapterError("Source response exceeds the configured size limit.", false);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ContentSourceAdapterError("Source response exceeds the configured size limit.", false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function fetchBoundedText(input: Readonly<{
  url: string;
  fetch: typeof fetch;
  allowedHosts: readonly string[];
  allowedContentTypes: readonly string[];
  maxBytes: number;
  headers?: HeadersInit;
  signal?: AbortSignal;
  maxRedirects?: number;
  isAllowedUrl?: (url: URL) => boolean;
}>): Promise<BoundedTextResponse> {
  const allowedHosts = new Set(input.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (allowedHosts.size === 0) {
    throw new ContentSourceAdapterError("At least one source host must be allowlisted.", false);
  }
  let current = safeUrl(input.url, allowedHosts);
  if (input.isAllowedUrl && !input.isAllowedUrl(current)) {
    throw new ContentSourceAdapterError("Source URL is outside the authorized URL boundary.", false);
  }
  const maxRedirects = input.maxRedirects ?? 3;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (input.signal?.aborted) {
      throw new ContentSourceAdapterError("Source request was cancelled.", false);
    }
    let response: Response;
    try {
      response = await input.fetch(current, {
        headers: input.headers,
        redirect: "manual",
        signal: input.signal,
      });
    } catch {
      if (input.signal?.aborted) {
        throw new ContentSourceAdapterError("Source request was cancelled.", false);
      }
      throw new ContentSourceAdapterError("Source request failed.", true);
    }
    if (response.status === 304) {
      return { text: "", url: current.toString(), status: 304, headers: response.headers };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ContentSourceAdapterError("Source redirect omitted its destination.", false);
      if (redirects === maxRedirects) throw new ContentSourceAdapterError("Source redirect limit was exceeded.", false);
      current = safeUrl(new URL(location, current).toString(), allowedHosts);
      if (input.isAllowedUrl && !input.isAllowedUrl(current)) {
        throw new ContentSourceAdapterError("Source redirect left the authorized URL boundary.", false);
      }
      continue;
    }
    if (!response.ok) {
      throw new ContentSourceAdapterError(`Source returned HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!input.allowedContentTypes.some((allowed) => contentType.split(";", 1)[0]?.trim() === allowed)) {
      throw new ContentSourceAdapterError("Source returned an unsupported Content-Type.", false);
    }
    const body = await readBody(response, input.maxBytes);
    let text: string;
    try {
      text = new TextDecoder(responseCharset(contentType, body), { fatal: true }).decode(body);
    } catch {
      throw new ContentSourceAdapterError("Source response uses an unsupported or invalid encoding.", false);
    }
    return { text, url: response.url || current.toString(), status: response.status, headers: response.headers };
  }
  throw new ContentSourceAdapterError("Source redirect limit was exceeded.", false);
}
