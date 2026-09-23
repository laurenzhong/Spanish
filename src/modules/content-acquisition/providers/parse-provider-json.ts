function scanProviderJsonObjects(text: string): unknown[] {
  const normalized = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  try { return [JSON.parse(normalized) as unknown]; } catch { /* extract bounded objects below */ }
  const objects: unknown[] = [];
  let searchFrom = 0;
  while (searchFrom < normalized.length) {
    const start = normalized.indexOf("{", searchFrom);
    if (start < 0) break;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') { quoted = true; continue; }
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try { objects.push(JSON.parse(normalized.slice(start, index + 1)) as unknown); } catch { /* keep scanning */ }
          searchFrom = index + 1;
          break;
        }
      }
    }
    if (searchFrom <= start) break;
  }
  return objects;
}

/** Parse the first JSON object even when a model wraps it in a code fence or short prose. */
export function parseProviderJson(text: string): unknown {
  return scanProviderJsonObjects(text)[0] ?? null;
}

/** Return every bounded JSON object so callers can select one matching their schema. */
export function parseProviderJsonCandidates(text: string): readonly unknown[] {
  return scanProviderJsonObjects(text);
}
