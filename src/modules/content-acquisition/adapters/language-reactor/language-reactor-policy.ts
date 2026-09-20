import type { ContentSourceRecord } from "../../repositories";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { LanguageReactorAdapter, languageReactorRightsPolicySchema } from "./language-reactor-adapter";

export function createLanguageReactorAdapterFromSource(
  source: ContentSourceRecord,
  fetchImpl: typeof fetch = fetch,
): LanguageReactorAdapter {
  if (
    !source.enabled
    || source.adapterType !== "language-reactor"
    || !["video-channel", "podcast-feed"].includes(source.sourceKind)
    || source.rightsStatus !== "verified"
    || source.language !== "es"
  ) {
    throw new ContentSourceAdapterError("Language Reactor requires an enabled, verified Spanish media source.", false);
  }
  const policy = languageReactorRightsPolicySchema.safeParse(source.rightsPolicy ?? {});
  if (!policy.success || policy.data.minDurationMs > policy.data.maxDurationMs) {
    throw new ContentSourceAdapterError("Language Reactor source rights policy is incomplete or invalid.", false);
  }
  const directoryUrl = new URL(policy.data.directoryUrl);
  if (directoryUrl.hostname !== "www.languagereactor.com" || !/^t_(?:pd|yt)_/u.test(source.externalSourceId)) {
    throw new ContentSourceAdapterError("Language Reactor source identity is invalid.", false);
  }
  return new LanguageReactorAdapter({
    fetch: fetchImpl,
    source: {
      sourceKind: source.sourceKind as "video-channel" | "podcast-feed",
      playlistId: source.externalSourceId,
      displayName: source.displayName,
      region: source.region,
      policy: policy.data,
    },
  });
}
