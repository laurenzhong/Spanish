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
  let directoryUrl: URL;
  try {
    directoryUrl = new URL(policy.data.directoryUrl);
  } catch {
    throw new ContentSourceAdapterError("Language Reactor directory URL is invalid.", false);
  }
  if (directoryUrl.hostname !== "www.languagereactor.com") {
    throw new ContentSourceAdapterError("Language Reactor directory URL must use the official host.", false);
  }
  if (!/^t_(?:pd|yt)_/u.test(source.externalSourceId)) {
    throw new ContentSourceAdapterError("Language Reactor playlist identity is invalid.", false);
  }
  return new LanguageReactorAdapter({
    fetch: fetchImpl,
    source: {
      sourceKind: source.sourceKind,
      playlistId: source.externalSourceId,
      directoryUrl: directoryUrl.toString(),
      displayName: source.displayName,
      region: source.region,
      policy: policy.data,
    },
  });
}
