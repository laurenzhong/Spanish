import { contentSourcePageSchema, type ContentSourcePage } from "../schemas";
import {
  ContentSourceAdapterError,
  type ContentSourceAdapter,
  type ContentSourceDiscoveryInput,
} from "./content-source-adapter";

export class FakeContentSourceAdapter implements ContentSourceAdapter {
  readonly key = "fake" as const;
  readonly calls: ContentSourceDiscoveryInput[] = [];
  private readonly pages: readonly ContentSourcePage[];

  constructor(pages: readonly ContentSourcePage[]) {
    this.pages = pages.map((page) => contentSourcePageSchema.parse(page));
  }

  async discover(
    input: ContentSourceDiscoveryInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ContentSourcePage> {
    if (options?.signal?.aborted) {
      throw new ContentSourceAdapterError("Source discovery was cancelled.", false);
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new ContentSourceAdapterError("Discovery limit is outside the supported range.", false);
    }
    this.calls.push({ ...input });
    const page = this.pages.find(
      (candidate) =>
        candidate.sourceStableKey === input.sourceStableKey &&
        candidate.cursor === input.cursor,
    );
    if (!page) {
      return contentSourcePageSchema.parse({
        sourceStableKey: input.sourceStableKey,
        cursor: input.cursor,
        nextCursor: null,
        estimatedCostMicros: 0,
        items: [],
      });
    }
    return {
      ...page,
      items: page.items.slice(0, input.limit),
    };
  }
}
