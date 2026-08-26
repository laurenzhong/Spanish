import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function hashContentBundle(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function hashArticleContent(value: unknown): string {
  const article = structuredClone(value) as Record<string, unknown>;
  delete article.contentHash;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(article)))
    .digest("hex");
}
