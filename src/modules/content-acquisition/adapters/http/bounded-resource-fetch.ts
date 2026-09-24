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
    throw new ContentSourceAdapterError("Resource URL is invalid.", false, "RESOURCE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ContentSourceAdapterError("Resource URL must be credential-free HTTPS.", false, "RESOURCE_URL_NOT_CREDENTIAL_FREE_HTTPS");
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new ContentSourceAdapterError("Resource host is not in the allowlist.", false, "RESOURCE_HOST_NOT_ALLOWLISTED");
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
  maxAttempts?: number;
  retryDelayMs?: number;
}>): Promise<BoundedResourceMetadata> {
  const allowedHosts = new Set(input.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (allowedHosts.size === 0) {
    throw new ContentSourceAdapterError("At least one resource host must be allowlisted.", false, "RESOURCE_ALLOWLIST_EMPTY");
  }
  let current = safeResourceUrl(input.url, allowedHosts);
  const maxRedirects = input.maxRedirects ?? 3;
  const maxAttempts = Math.max(1, Math.min(4, input.maxAttempts ?? 3));
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 250);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (input.signal?.aborted) throw new ContentSourceAdapterError("Resource request was cancelled.", false, "RESOURCE_REQUEST_CANCELLED");
    let response: Response | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await input.fetch(current, { method: "HEAD", redirect: "manual", signal: input.signal });
      } catch {
        if (input.signal?.aborted) throw new ContentSourceAdapterError("Resource request was cancelled.", false, "RESOURCE_REQUEST_CANCELLED");
        if (attempt === maxAttempts) throw new ContentSourceAdapterError("Resource request failed.", true, "RESOURCE_REQUEST_FAILED");
      }
      if (response && !(response.status === 429 || response.status >= 500)) break;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** (attempt - 1)));
    }
    if (!response) throw new ContentSourceAdapterError("Resource request failed.", true, "RESOURCE_REQUEST_FAILED");
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ContentSourceAdapterError("Resource redirect omitted its destination.", false, "RESOURCE_REDIRECT_MISSING_LOCATION");
      if (redirects === maxRedirects) throw new ContentSourceAdapterError("Resource redirect limit was exceeded.", false, "RESOURCE_REDIRECT_LIMIT_EXCEEDED");
      current = safeResourceUrl(new URL(location, current).toString(), allowedHosts);
      continue;
    }
    if (!response.ok) {
      throw new ContentSourceAdapterError(`Resource returned HTTP ${response.status}.`, response.status >= 500 || response.status === 429, `RESOURCE_HTTP_${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!input.allowedContentTypes.includes(contentType)) {
      throw new ContentSourceAdapterError("Resource returned an unsupported Content-Type.", false, "RESOURCE_CONTENT_TYPE_UNSUPPORTED");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > input.maxBytes) {
      throw new ContentSourceAdapterError("Resource size is missing or exceeds the configured limit.", false, "RESOURCE_SIZE_INVALID_OR_TOO_LARGE");
    }
    return { url: current.toString(), contentType, contentLength, headers: response.headers };
  }
  throw new ContentSourceAdapterError("Resource redirect limit was exceeded.", false, "RESOURCE_REDIRECT_LIMIT_EXCEEDED");
}
