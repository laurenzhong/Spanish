import type { Metadata } from "next";

import {
  listSavedShelfItems,
  projectSavedShelfItem,
  savedShelfQuerySchema,
} from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { SavedItemsLibrary } from "@/src/modules/reading/ui/saved-items-library";
import { ReadSectionNavigation } from "@/src/modules/lexicon-corpus";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "已保存 · 阅读" };

type SavedItemsPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

const SAVED_ITEMS_LOAD_TIMEOUT_MS = 2_500;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("SAVED_ITEMS_LOAD_TIMEOUT")), milliseconds); }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
}

export default async function SavedItemsPage({ searchParams }: SavedItemsPageProps) {
  const params = await searchParams;
  const rawQuery = {
    search: first(params.search),
    itemType: first(params.itemType) ?? first(params.type),
    page: first(params.page),
    pageSize: first(params.pageSize),
  };
  const parsed = savedShelfQuerySchema.safeParse(rawQuery);
  const query = parsed.success ? parsed.data : savedShelfQuerySchema.parse({});
  let result: Awaited<ReturnType<typeof listSavedShelfItems>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let unavailable = false;

  if (process.env.DATABASE_URL) {
    try {
      result = await withTimeout((async () => {
        const user = await getCurrentUser();
        if (!user) throw new Error("AUTH_REQUIRED");
        return listSavedShelfItems(createDrizzleReadingRepository(getDatabase()), user.id, query);
      })(), SAVED_ITEMS_LOAD_TIMEOUT_MS);
    } catch {
      unavailable = true;
    }
  } else {
    unavailable = true;
  }

  // The client shelf keeps an optimistic `rows` projection after a removal.
  // Include the returned item identities in the key so a same-count refresh
  // (for example, a replacement from another tab) cannot leave stale cards
  // mounted across a server navigation.
  const resultKey = [
    query.search,
    query.itemType,
    query.page,
    query.pageSize,
    result.total,
    result.items.map((item) => item.itemType === "article"
      ? `${item.articleId}:${item.createdAt.getTime()}:${item.saved}`
      : `${item.id}:${item.createdAt.getTime()}`).join(","),
    unavailable,
  ].join(":");
  return <div className="page-stack read-page"><ReadSectionNavigation active="saved-items" /><SavedItemsLibrary key={resultKey} items={result.items.map(projectSavedShelfItem)} total={result.total} page={result.page} pageSize={result.pageSize} search={query.search ?? ""} itemType={query.itemType} unavailable={unavailable} /></div>;
}
