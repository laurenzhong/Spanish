"use client";

import { usePathname } from "next/navigation";

import { ReadSectionNavigation, type ReadSectionKey } from "@/src/modules/lexicon-corpus";

/**
 * Which tab of the reading navigation a `/read/*` URL belongs to.
 *
 * The navigation is rendered by the section layout now, so no page can tell it
 * which tab is current — the URL is the only fact left, and it is the right one:
 * a deep link, a back button and a prefetch all carry it.
 *
 * The article reader and the private story generator are not destinations of
 * their own; both are readings inside 文章, so they keep that tab current rather
 * than leaving the navigation with nothing underlined. Everything else under
 * `/read` that matches no destination (including the section root) falls back to
 * 文章 as well, which is where the section starts.
 */
export function activeReadSection(pathname: string): ReadSectionKey {
  const path = pathname.replace(/\/+$/u, "");
  if (path.startsWith("/read/vocabulary")) return "vocabulary";
  if (path.startsWith("/read/phrases")) return "phrases";
  if (path.startsWith("/read/corpus")) return "corpus";
  // `/read/saved` is the old alias of `/read/saved-items`; both are the shelf.
  if (path.startsWith("/read/saved")) return "saved-items";
  return "articles";
}

/**
 * The interactive reading navigation, mounted once by `read/layout.tsx`.
 *
 * It is a client component only because the current tab depends on the URL: the
 * layout is shared by every route in the section and receives no pathname. The
 * destinations themselves are the module's own links, so nothing here decides
 * where a tab points.
 */
export function ReadSectionNavHost() {
  const pathname = usePathname();
  // Readers provide their own return link and toolbar, including while loading.
  if (pathname.startsWith("/read/article/")) return null;
  return <ReadSectionNavigation active={activeReadSection(pathname)} />;
}
