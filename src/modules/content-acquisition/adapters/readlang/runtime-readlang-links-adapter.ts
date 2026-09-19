import policyV2Json from "@/content/source-policies/readlang-links-v2.json";
import policyV5Json from "@/content/source-policies/readlang-links-v5.json";

import type { ContentSourceRecord } from "../../repositories";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { ReadlangLinksAdapter } from "./readlang-links-adapter";
import { readlangLinksPolicySchema } from "./readlang-links-policy";

export function createReadlangLinksAdapterFromSource(source: ContentSourceRecord, fetchImpl: typeof fetch = fetch): ReadlangLinksAdapter {
  if (!source.enabled || source.adapterType !== "readlang-links" || source.sourceKind !== "article-site" || source.rightsStatus !== "verified") {
    throw new ContentSourceAdapterError("Readlang links requires an enabled, verified article-site source.", false);
  }
  const policy = readlangLinksPolicySchema.parse(
    source.rightsPolicy?.policyVersion === "readlang-links-v5" ? policyV5Json : policyV2Json,
  );
  if (source.externalSourceId !== policy.sourceUrl || source.rightsPolicy?.policyVersion !== policy.policyVersion) {
    throw new ContentSourceAdapterError("Readlang links source policy does not match the registered policy.", false);
  }
  return new ReadlangLinksAdapter({ fetch: fetchImpl, policy, maxArticleBytes: policy.maxArticleBytes });
}
