import type { Metadata } from "next";

import { FakeTrainingLoop } from "@/src/modules/training/ui/fake-training-loop";
import {
  articleTransferTask,
  parseArticleTransferType,
} from "@/src/modules/content/domain";
import { getArticle } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";
import { getCurrentUser } from "@/src/shared/auth/server";

export const metadata: Metadata = {
  title: "表达练习",
};

type PracticePageProps = Readonly<{
  searchParams: Promise<{
    article?: string | string[];
    transfer?: string | string[];
    goal?: string | string[];
  }>;
}>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export default async function PracticePage({ searchParams }: PracticePageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const transferType = parseArticleTransferType(firstParam(params.transfer));
  const articleId = firstParam(params.article);
  const goalKey = firstParam(params.goal);
  let articleTransfer;
  const decodedArticleId = articleId ? decodeParam(articleId) : null;
  if (transferType && decodedArticleId) {
    const result = await getArticle(new BundleArticleRepository(), decodedArticleId);
    if (result.reason === "found" && result.article) {
      articleTransfer = articleTransferTask(result.article, transferType);
    }
  }
  return <FakeTrainingLoop userId={user?.id ?? "local-user"} goalKey={goalKey} articleTransfer={articleTransfer} />;
}
