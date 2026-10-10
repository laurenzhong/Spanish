/** Validate the final HTTP response, not proxy CONNECT or interim headers. */
export function finalMediaHeaders(raw: string) {
  const blocks = raw.trim().split(/\r?\n\r?\n/u).filter((part) => /^HTTP\//u.test(part));
  const block = blocks.at(-1);
  if (!block) throw new Error("MEDIA_HEADERS_INVALID");
  const [statusLine, ...lines] = block.split(/\r?\n/u);
  const status = Number(statusLine.split(" ")[1]);
  const headers = new Headers();
  for (const line of lines) {
    const at = line.indexOf(":");
    if (at > 0) headers.append(line.slice(0, at), line.slice(at + 1).trim());
  }
  return { status, headers };
}

export function validateMediaRange(raw: string, start: number, end: number, total: number, actualBytes: number) {
  const { status, headers } = finalMediaHeaders(raw);
  if (status !== 206 || headers.get("content-range") !== `bytes ${start}-${end}/${total}` || actualBytes !== end - start + 1) {
    throw new Error("MEDIA_RANGE_INVALID");
  }
  const length = headers.get("content-length");
  if (length !== null && Number(length) !== actualBytes) throw new Error("MEDIA_RANGE_INVALID");
  if (!headers.get("content-type")?.toLowerCase().startsWith("video/mp4")) throw new Error("MEDIA_MIME_INVALID");
}

export function validateHostedSource(url: string, origin: string) {
  const source = new URL(url);
  if (source.origin !== new URL(origin).origin || source.protocol !== "https:" || source.username || source.password || source.search || source.hash || !source.pathname.startsWith("/storage/v1/object/public/media-video/media/")) {
    throw new Error("MEDIA_SOURCE_INVALID");
  }
  return source;
}

export function canRelocateHostedVideoReferences(stableKey: string, references: ReadonlyArray<{
  kind: string; provider_key: string; stable_key: string; copyright_status: string;
}>) {
  return references.every((row) => row.kind === "video" && row.provider_key === "supabase-storage:media-video" && row.stable_key === stableKey && row.copyright_status === "cleared");
}
