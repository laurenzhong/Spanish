import type { StoryGenerationProvider } from "@/src/modules/providers/story-generation";

import {
  generatedStoryToProviderInput,
  normalizeGeneratedStoryRequest,
  type GeneratedStoryRequest,
} from "../domain/generated-story";
import type { GeneratedArticleRepository } from "../repositories/generated-article-repository";

export async function generatePrivateStory(
  repository: GeneratedArticleRepository,
  provider: StoryGenerationProvider,
  userId: string,
  input: GeneratedStoryRequest,
  requestId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  const request = normalizeGeneratedStoryRequest(input);
  const result = await provider.generate(generatedStoryToProviderInput(request), { signal });
  if (result.cefr !== request.cefr) throw new Error("GENERATED_STORY_CEFR_MISMATCH");
  return repository.create(userId, request, result, requestId, idempotencyKey);
}

export async function listPrivateStories(repository: GeneratedArticleRepository, userId: string, query?: Parameters<GeneratedArticleRepository["list"]>[1]) {
  return repository.list(userId, query);
}

export async function getPrivateStory(repository: GeneratedArticleRepository, userId: string, articleId: string) {
  return repository.findById(userId, articleId.trim().slice(0, 240));
}

export async function deletePrivateStory(repository: GeneratedArticleRepository, userId: string, articleId: string) {
  return repository.delete(userId, articleId.trim().slice(0, 240));
}
