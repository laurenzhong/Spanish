import type { ContentSourcePage, SourceAdapterType } from "../schemas";

export type ContentSourceDiscoveryInput = Readonly<{
  sourceStableKey: string;
  externalSourceId: string;
  cursor: string | null;
  limit: number;
}>;

export class ContentSourceAdapterError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(message: string, public readonly retryable: boolean) {
    super(`CONTENT_PROCESSING_FAILED: ${message}`);
    this.name = "ContentSourceAdapterError";
  }
}

export interface ContentSourceAdapter {
  readonly key: SourceAdapterType;
  discover(
    input: ContentSourceDiscoveryInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ContentSourcePage>;
}
