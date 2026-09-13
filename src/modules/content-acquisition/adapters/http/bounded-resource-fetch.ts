import { ContentSourceAdapterError } from "../content-source-adapter";

export type BoundedResourceMetadata = Readonly<{
  url: string;
  contentType: string;
  contentLength: number;
  headers: Headers;
}>;

function safeResourceUrl(input: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ContentSourceAdapterError("Resource URL is invalid.", false);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ContentSourceAdapterError("Resource URL must be credential-free HTTPS.", false);
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new ContentSourceAdapterError("Resource host is not in the allowlist.", false);
  }
  return url;
}

export async function fetchBoundedResourceMetadata(input: Readonly<{
  url: string;
  fetch: typeof fetch;
  allowedHosts: readonly string[];
  allowedContentTypes: readonly string[];
  maxBytes: number;
  signal?: AbortSignal;
  maxRedirects?: number;
}>): Promise<BoundedResourceMetadata> {
  const allowedHosts = new Set(input.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (allowedHosts.size === 0) {
    throw new ContentSourceAdapterError("At least one resource host must be allowlisted.", false);
  }
  let current = safeResourceUrl(input.url, allowedHosts);
  const maxRedirects = input.maxRedirects ?? 3;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (input.signal?.aborted) throw new ContentSourceAdapterError("Resource request was cancelled.", false);
    let response: Response;
    try {
      response = await input.fetch(current, { method: "HEAD", redirect: "manual", signal: input.signal });
    } catch {
      if (input.signal?.aborted) throw new ContentSourceAdapterError("Resource request was cancelled.", false);
      throw new ContentSourceAdapterError("Resource request failed.", true);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ContentSourceAdapterError("Resource redirect omitted its destination.", false);
      if (redirects === maxRedirects) throw new ContentSourceAdapterError("Resource redirect limit was exceeded.", false);
      current = safeResourceUrl(new URL(location, current).toString(), allowedHosts);
      continue;
    }
    if (!response.ok) {
      throw new ContentSourceAdapterError(`Resource returned HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!input.allowedContentTypes.includes(contentType)) {
      throw new ContentSourceAdapterError("Resource returned an unsupported Content-Type.", false);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > input.maxBytes) {
      throw new ContentSourceAdapterError("Resource size is missing or exceeds the configured limit.", false);
    }
    return { url: current.toString(), contentType, contentLength, headers: response.headers };
  }
  throw new ContentSourceAdapterError("Resource redirect limit was exceeded.", false);
}
