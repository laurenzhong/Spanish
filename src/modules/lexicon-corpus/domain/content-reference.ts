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
