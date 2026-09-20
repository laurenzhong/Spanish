import policyV2Json from "@/content/source-policies/readlang-links-v2.json";
import policyV3Json from "@/content/source-policies/readlang-links-v3.json";
import policyV4Json from "@/content/source-policies/readlang-links-v4.json";
import policyV5Json from "@/content/source-policies/readlang-links-v5.json";
import policyV6Json from "@/content/source-policies/readlang-links-v6.json";

import type { ContentSourceRecord } from "../../repositories";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { ReadlangLinksAdapter } from "./readlang-links-adapter";
import { readlangLinksPolicySchema } from "./readlang-links-policy";

export function createReadlangLinksAdapterFromSource(source: ContentSourceRecord, fetchImpl: typeof fetch = fetch): ReadlangLinksAdapter {
  if (!source.enabled || source.adapterType !== "readlang-links" || source.sourceKind !== "article-site" || source.rightsStatus !== "verified") {
    throw new ContentSourceAdapterError("Readlang links requires an enabled, verified article-site source.", false);
  }
  const policyJson = source.rightsPolicy?.policyVersion === "readlang-links-v6"
    ? policyV6Json
    : source.rightsPolicy?.policyVersion === "readlang-links-v5"
      ? policyV5Json
      : source.rightsPolicy?.policyVersion === "readlang-links-v4"
        ? policyV4Json
        : source.rightsPolicy?.policyVersion === "readlang-links-v3"
          ? policyV3Json
          : policyV2Json;
  const policy = readlangLinksPolicySchema.parse(policyJson);
  if (source.externalSourceId !== policy.sourceUrl || source.rightsPolicy?.policyVersion !== policy.policyVersion) {
    throw new ContentSourceAdapterError("Readlang links source policy does not match the registered policy.", false);
  }
  return new ReadlangLinksAdapter({ fetch: fetchImpl, policy, maxArticleBytes: policy.maxArticleBytes });
}
