/** Bound announced and streamed JSON before parsing private drafts. */
export async function readExpressionAssistBody(request: Request): Promise<unknown> {
  const maximumBytes = 16 * 1024;
  if (Number(request.headers.get("content-length")) > maximumBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new SyntaxError("Expression assistance request exceeds its limit.");
  }
  if (!request.body) throw new SyntaxError("Expression assistance request is empty.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let completed = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { completed = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new SyntaxError("Expression assistance request exceeds its limit.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    request.signal.removeEventListener("abort", abort);
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
