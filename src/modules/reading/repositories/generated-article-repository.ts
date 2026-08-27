import type { GeneratedStoryCard, GeneratedStoryReader, GeneratedStoryRequest } from "../domain/generated-story";
import type { StoryGenerationResult } from "@/src/modules/providers/story-generation";

export type GeneratedStoryListQuery = Readonly<{
  search?: string;
  cursor?: string;
  pageSize?: number;
}>;

export type GeneratedStoryListResult = Readonly<{
  articles: readonly GeneratedStoryCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export interface GeneratedArticleRepository {
  create(
    userId: string,
    request: GeneratedStoryRequest,
    result: StoryGenerationResult,
    requestId: string,
    idempotencyKey: string,
  ): Promise<GeneratedStoryReader>;
  findById(userId: string, articleId: string): Promise<GeneratedStoryReader | null>;
  list(userId: string, query?: GeneratedStoryListQuery): Promise<GeneratedStoryListResult>;
  delete(userId: string, articleId: string): Promise<boolean>;
}
