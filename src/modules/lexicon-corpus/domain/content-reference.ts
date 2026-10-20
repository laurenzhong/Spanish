export type ContentDocumentRef =
  | Readonly<{ kind: "article"; stableKey: string; version: number }>
  | Readonly<{ kind: "media"; stableKey: string; version: number }>;

export type SourcePosition =
  | Readonly<{ kind: "text"; paragraphId: string; segmentIndex: number }>
  | Readonly<{ kind: "media"; startMs: number; endMs: number; segmentIndex: number }>;

export type ContentReference = Readonly<{
  document: ContentDocumentRef;
  position: SourcePosition;
  sourceText: string;
  contextBefore: string;
  contextAfter: string;
}>;

export function contentSourceHref(document: ContentDocumentRef, position: SourcePosition): string {
  const stableKey = encodeURIComponent(document.stableKey);
  if (document.kind === "article" && position.kind === "text") {
    return `/read/article/${encodeURIComponent(`${document.stableKey}@${document.version}`)}#segment-${position.segmentIndex}`;
  }
  if (document.kind === "media" && position.kind === "media") {
    return `/learn/media/${stableKey}?t=${position.startMs}&segment=${position.segmentIndex}#segment-${position.segmentIndex}`;
  }
  return document.kind === "article" ? `/read/article/${encodeURIComponent(`${document.stableKey}@${document.version}`)}` : `/learn/media/${stableKey}`;
}
